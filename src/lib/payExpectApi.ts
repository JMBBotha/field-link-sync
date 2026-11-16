/** Load and save expected-payment settings. Saving goes through the admin RPCs.
 *  A missing preview table keeps the built-in defaults so Home still loads. */
import { supabase } from "@/integrations/supabase/client";
import {
  payExpectSettings,
  type DateMode,
  type ExpectContext,
  type ExpectJob,
  type ExpectQuote,
  type InvoiceExpectOverride,
  type PayExpectSettings,
  type ProjectExpectOverride,
  type ProjectTiming,
} from "@/lib/expectedPayDates";

const db = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string; code?: string; details?: string } | null }>;
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string; code?: string; details?: string } | null }>;
        in: (col: string, values: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string; code?: string; details?: string } | null }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
};

function missing(error: { message?: string; code?: string; details?: string } | null): boolean {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /pay_expect_|does not exist|42P01|schema cache/i.test(msg);
}

function timingOf(value: unknown): ProjectTiming | null {
  return value === "project" || value === "normal" ? value : null;
}

function modeOf(value: unknown): DateMode | null {
  return value === "days_after" || value === "day_of_month" || value === "month_end" ? value : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jobOf(row: Record<string, unknown>): ExpectJob {
  return {
    id: String(row.id),
    quoteId: (row.quote_id as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    leadId: (row.lead_id as string | null) ?? null,
    customerId: (row.customer_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    status: (row.status as string | null) ?? null,
  };
}

export async function fetchPayExpect(input: {
  companyId: string;
  invoiceIds: string[];
  quoteIds: string[];
  leadIds: string[];
  quotes: ExpectQuote[];
  defaultDepositPct: number | null;
}): Promise<ExpectContext> {
  const cols = "id, quote_id, invoice_id, lead_id, customer_id, title, description, completed_at, status";
  const [projects, houses, defaults, projectRows, invoiceRows, byInvoice, byQuote, byLead] = await Promise.all([
    db.from("projects").select("id, customer_id").eq("company_id", input.companyId).limit(500),
    db.from("project_houses").select("id, project_id, house_no").eq("company_id", input.companyId).limit(5000),
    db.from("pay_expect_defaults").select("project_deposit_days, project_final_days, window_extra_days, normal_deposit_days, normal_final_days, late_grace_days").eq("company_id", input.companyId).maybeSingle(),
    db.from("pay_expect_project").select("project_id, timing, date_mode, deposit_days, final_days, window_extra_days, day_of_month, month_offset").eq("company_id", input.companyId).limit(500),
    db.from("pay_expect_invoice").select("invoice_id, part, expected_on").eq("company_id", input.companyId).limit(2000),
    input.invoiceIds.length ? db.from("jobs").select(cols).eq("company_id", input.companyId).in("invoice_id", input.invoiceIds.slice(0, 400)) : Promise.resolve({ data: [], error: null }),
    input.quoteIds.length ? db.from("jobs").select(cols).eq("company_id", input.companyId).in("quote_id", input.quoteIds.slice(0, 400)) : Promise.resolve({ data: [], error: null }),
    input.leadIds.length ? db.from("jobs").select(cols).eq("company_id", input.companyId).in("lead_id", input.leadIds.slice(0, 400)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (projects.error) throw projects.error;
  if (houses.error) throw houses.error;
  for (const res of [byInvoice, byQuote, byLead]) if (res.error) throw res.error;
  if (defaults.error && !missing(defaults.error)) throw defaults.error;
  if (projectRows.error && !missing(projectRows.error)) throw projectRows.error;
  if (invoiceRows.error && !missing(invoiceRows.error)) throw invoiceRows.error;
  const row = defaults.data;
  const settings = payExpectSettings(row ? {
    projectDepositDays: Number(row.project_deposit_days),
    projectFinalDays: Number(row.project_final_days),
    windowExtraDays: Number(row.window_extra_days),
    normalDepositDays: Number(row.normal_deposit_days),
    normalFinalDays: Number(row.normal_final_days),
    lateGraceDays: Number(row.late_grace_days),
  } : null);
  const projectOverrides: ProjectExpectOverride[] = (projectRows.error ? [] : projectRows.data || []).map((item) => ({
    projectId: String(item.project_id),
    timing: timingOf(item.timing),
    dateMode: modeOf(item.date_mode),
    depositDays: num(item.deposit_days),
    finalDays: num(item.final_days),
    windowExtraDays: num(item.window_extra_days),
    dayOfMonth: num(item.day_of_month),
    monthOffset: num(item.month_offset),
  }));
  const invoiceOverrides: InvoiceExpectOverride[] = (invoiceRows.error ? [] : invoiceRows.data || []).flatMap((item) => {
    const part = item.part === "deposit" || item.part === "final" ? item.part : null;
    const expectedOn = String(item.expected_on || "").slice(0, 10);
    if (!part || !/^\d{4}-\d{2}-\d{2}$/.test(expectedOn)) return [];
    return [{ invoiceId: String(item.invoice_id), part, expectedOn }];
  });
  const jobs = new Map<string, ExpectJob>();
  for (const res of [byInvoice, byQuote, byLead]) {
    for (const item of res.data || []) jobs.set(String(item.id), jobOf(item));
  }
  return {
    settings,
    houses: (houses.data || []).map((item) => ({ id: String(item.id), projectId: String(item.project_id), houseNo: String(item.house_no || "") })),
    projects: (projects.data || []).map((item) => ({ id: String(item.id), customerId: (item.customer_id as string | null) ?? null })),
    projectOverrides,
    invoiceOverrides,
    jobs: [...jobs.values()],
    quotes: input.quotes,
    defaultDepositPct: input.defaultDepositPct,
  };
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message || "Could not save that.");
}

export function savePayExpectDefaults(companyId: string, settings: PayExpectSettings): Promise<void> {
  return call("save_pay_expect_defaults", {
    p_company: companyId,
    p_project_deposit_days: settings.projectDepositDays,
    p_project_final_days: settings.projectFinalDays,
    p_window_extra_days: settings.windowExtraDays,
    p_normal_deposit_days: settings.normalDepositDays,
    p_normal_final_days: settings.normalFinalDays,
    p_late_grace_days: settings.lateGraceDays,
  });
}

export function savePayExpectProject(row: ProjectExpectOverride & { clear?: boolean }): Promise<void> {
  return call("save_pay_expect_project", {
    p_project: row.projectId,
    p_clear: !!row.clear,
    p_timing: row.timing,
    p_date_mode: row.dateMode,
    p_deposit_days: row.depositDays,
    p_final_days: row.finalDays,
    p_window_extra_days: row.windowExtraDays,
    p_day_of_month: row.dayOfMonth,
    p_month_offset: row.monthOffset,
  });
}

export function savePayExpectInvoice(invoiceId: string, part: "deposit" | "final", expectedOn: string | null): Promise<void> {
  return call("save_pay_expect_invoice", { p_invoice: invoiceId, p_part: part, p_expected_on: expectedOn });
}
