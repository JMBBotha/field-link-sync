/** Automatic expected payment dates.
 *  A developer project that groups more than one house uses the project rule.
 *  A standalone job, including a project with a single house, uses the normal rule.
 *  An admin can force either timing on a project. The project date rule is then one of:
 *  days after the invoice date (the default), a fixed day of the month, or the last day of the month.
 *  Fixed day and month end also take a month offset: 0 is the invoice's own month, 1 is the next month.
 *  A per-invoice date replaces all of that. Nothing here writes an invoice or a payment.
 *  Draft invoices 0010021 and 0010023, and invoice-to-house coverage, are out of scope. */
import { fmtDay } from "@/lib/balanceDue";
import type { HomeInvoice } from "@/lib/adminHomeCount";
import { jhbDate } from "@/lib/drilldown";
import type { AutoExpected } from "@/lib/expectedMoney";
import { isValidPlan } from "@/lib/paymentPlans";
import { namesHouse } from "@/lib/projectTracker";

export const PAY_EXPECT_DEFAULTS = {
  projectDepositDays: 15,
  projectFinalDays: 15,
  windowExtraDays: 5,
  normalDepositDays: 3,
  normalFinalDays: 7,
  lateGraceDays: 3,
} as const;

export type DateMode = "days_after" | "day_of_month" | "month_end";
export type ProjectTiming = "project" | "normal";

export interface PayExpectSettings {
  projectDepositDays: number;
  projectFinalDays: number;
  windowExtraDays: number;
  normalDepositDays: number;
  normalFinalDays: number;
  lateGraceDays: number;
}

export interface ProjectExpectOverride {
  projectId: string;
  /** null = automatic: project timing only when the project has more than one house. */
  timing: ProjectTiming | null;
  /** null = days after the invoice date. */
  dateMode: DateMode | null;
  depositDays: number | null;
  finalDays: number | null;
  windowExtraDays: number | null;
  /** 1–31. Used when dateMode is day_of_month. A short month clamps to its last day. */
  dayOfMonth: number | null;
  /** 0 = the invoice's own month. 1 = the next month. */
  monthOffset: number | null;
}

export interface InvoiceExpectOverride {
  invoiceId: string;
  part: "deposit" | "final";
  expectedOn: string;
}

export interface ExpectHouse {
  id: string;
  projectId: string;
  houseNo: string;
  /** Unit size or unit label from project_houses.unit_sizes. Display only. */
  unit?: string | null;
}

export interface ExpectProject {
  id: string;
  customerId: string | null;
  name?: string | null;
  code?: string | null;
}

export interface ExpectCoverage {
  invoiceId: string;
  projectHouseId: string;
  scope: "full_system" | "labour_extraction" | "units" | "deposit" | "balance";
  amountIncl: number;
}

export interface ExpectJob {
  id: string;
  quoteId?: string | null;
  invoiceId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  title?: string | null;
  description?: string | null;
  completedAt?: string | null;
  status?: string | null;
}

export interface ExpectQuote {
  id: string;
  companyId?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  acceptedAt?: string | null;
  total?: number | string | null;
  customerId?: string | null;
  customerName?: string | null;
  quoteNumber?: string | null;
  paymentPlan?: unknown;
}

export interface ExpectInvoice {
  id: string;
  companyId?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  notes?: string | null;
  issueDate?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  quoteId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  invoiceNumber?: string | null;
  projectHouseId?: string | null;
  balance: number;
  part: "deposit" | "final";
}

export interface ExpectContext {
  settings: PayExpectSettings;
  houses: ExpectHouse[];
  projects: ExpectProject[];
  projectOverrides: ProjectExpectOverride[];
  invoiceOverrides: InvoiceExpectOverride[];
  jobs: ExpectJob[];
  quotes: ExpectQuote[];
  defaultDepositPct: number | null;
  /** invoice_house_coverage rows. Home uses these to place an invoice on every house it covers. */
  coverage?: ExpectCoverage[];
}

export interface ComputedExpectLine {
  invoiceId: string;
  quoteId: string | null;
  part: "deposit" | "final";
  amount: number;
  date: string | null;
  windowEnd: string | null;
  label: string;
  href: string;
  display: string | null;
  estimate: boolean;
  timing: ProjectTiming;
  dateMode: DateMode | null;
  source: "computed" | "override" | "acceptance";
}

/** Live Stellenbosch Village. The preview seed names this id and is not applied to the live database. */
export const STELLENBOSCH_PROJECT_ID = "b00dc016-822d-411f-bf72-26a05537018f";

const CLOSED = new Set(["paid", "void", "cancelled", "canceled"]);

export function payExpectSettings(raw?: Partial<PayExpectSettings> | null): PayExpectSettings {
  return {
    projectDepositDays: clamp(raw?.projectDepositDays, PAY_EXPECT_DEFAULTS.projectDepositDays, 0, 365),
    projectFinalDays: clamp(raw?.projectFinalDays, PAY_EXPECT_DEFAULTS.projectFinalDays, 0, 365),
    windowExtraDays: clamp(raw?.windowExtraDays, PAY_EXPECT_DEFAULTS.windowExtraDays, 0, 90),
    normalDepositDays: clamp(raw?.normalDepositDays, PAY_EXPECT_DEFAULTS.normalDepositDays, 0, 365),
    normalFinalDays: clamp(raw?.normalFinalDays, PAY_EXPECT_DEFAULTS.normalFinalDays, 0, 365),
    lateGraceDays: clamp(raw?.lateGraceDays, PAY_EXPECT_DEFAULTS.lateGraceDays, 0, 90),
  };
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function monthShift(ymd: string, months: number): { y: number; m: number } {
  const [y, m] = ymd.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + Math.max(0, months), 1));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1 };
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Default timing (Johan 16 Nov 2026, 18:35). Several houses → project. One house, or none → normal. */
export function usesProjectTiming(houseCount: number, timing: ProjectTiming | null | undefined): boolean {
  if (timing === "project") return true;
  if (timing === "normal") return false;
  return houseCount > 1;
}

export function projectDateOn(invoiceDay: string, mode: DateMode, opts: { days: number; dayOfMonth: number; monthOffset: number }): string {
  if (mode === "days_after") return addDays(invoiceDay, opts.days);
  const { y, m } = monthShift(invoiceDay, opts.monthOffset);
  const end = lastDay(y, m);
  if (mode === "month_end") return ymd(y, m, end);
  return ymd(y, m, Math.min(Math.max(1, opts.dayOfMonth), end));
}

/** "Expected 1 Dec (1 to 6 Dec)". The range is only for days-after. An exact date has no range. */
export function expectDisplay(start: string, windowEnd: string | null, estimate: boolean): string {
  const startPretty = fmtDay(start);
  let text = `Expected ${startPretty}`;
  if (windowEnd && windowEnd !== start) {
    const endPretty = fmtDay(windowEnd);
    const sameMonth = start.slice(0, 7) === windowEnd.slice(0, 7);
    text += sameMonth ? ` (${Number(start.slice(8, 10))} to ${endPretty})` : ` (${startPretty} to ${endPretty})`;
  }
  return estimate ? `${text} · estimate` : text;
}

export function isLate(expectedOn: string, today: string, graceDays: number): boolean {
  const [fy, fm, fd] = expectedOn.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const past = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  return past > graceDays;
}

function invoiceDay(inv: Pick<ExpectInvoice, "issueDate" | "sentAt" | "createdAt">): string | null {
  return jhbDate(inv.issueDate) || jhbDate(inv.sentAt) || jhbDate(inv.createdAt);
}

function skipped(inv: Pick<ExpectInvoice, "status" | "archivedAt" | "balance" | "sentAt">): boolean {
  if (inv.archivedAt) return true;
  const status = String(inv.status || "").toLowerCase();
  if (CLOSED.has(status)) return true;
  if (status === "draft" && !inv.sentAt) return true;
  return !(inv.balance > 0.005);
}

function houseCountOf(projectId: string, houses: ExpectHouse[]): number {
  return houses.filter((house) => house.projectId === projectId).length;
}

function projectFromHouse(houseId: string | null | undefined, houses: ExpectHouse[]): string | null {
  if (!houseId) return null;
  return houses.find((house) => house.id === houseId)?.projectId || null;
}

function projectFromJob(job: ExpectJob, houses: ExpectHouse[], projects: ExpectProject[]): string | null {
  const owned = new Set(projects.filter((project) => project.customerId && project.customerId === job.customerId).map((project) => project.id));
  const candidates = houses.filter((house) => owned.has(house.projectId));
  const titled = candidates.filter((house) => namesHouse(job.title, house.houseNo));
  const hits = titled.length ? titled : candidates.filter((house) => namesHouse(job.description, house.houseNo));
  return hits[0]?.projectId || null;
}

function linkedJobs(inv: Pick<ExpectInvoice, "id" | "quoteId" | "leadId">, jobs: ExpectJob[]): ExpectJob[] {
  return jobs.filter((job) => job.invoiceId === inv.id || (!!inv.quoteId && job.quoteId === inv.quoteId) || (!!inv.leadId && job.leadId === inv.leadId));
}

function projectForInvoice(inv: ExpectInvoice, houses: ExpectHouse[], projects: ExpectProject[], jobs: ExpectJob[]): string | null {
  const direct = projectFromHouse(inv.projectHouseId, houses);
  if (direct) return direct;
  for (const job of linkedJobs(inv, jobs)) {
    const found = projectFromJob(job, houses, projects);
    if (found) return found;
  }
  return null;
}

function completedDay(inv: ExpectInvoice, jobs: ExpectJob[]): string | null {
  const days = linkedJobs(inv, jobs).map((job) => jhbDate(job.completedAt)).filter((day): day is string => !!day).sort();
  return days.length ? days[days.length - 1] : null;
}

function depositPct(plan: unknown, fallback: number | null): number {
  if (isValidPlan(plan) && plan.stages[0]) return plan.stages[0].pct;
  const n = Number(fallback);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 70;
}

function lineOf(part: ComputedExpectLine): ComputedExpectLine {
  return part;
}

function liveQuoteId(inv: { quoteId?: string | null; archivedAt?: string | null; status?: string | null }): string | null {
  if (!inv.quoteId || inv.archivedAt) return null;
  const status = String(inv.status || "").toLowerCase();
  if (status === "void" || status === "cancelled" || status === "canceled") return null;
  return inv.quoteId;
}

export interface ExpectedSchedule {
  date: string | null;
  windowEnd: string | null;
  display: string | null;
  estimate: boolean;
  timing: ProjectTiming;
  dateMode: DateMode | null;
  source: "computed" | "override";
}

/** The pay_expect date for one invoice, including a paid one. Archived, void, and unsent drafts have no date.
 *  A zero balance does not clear the date: the Home house row still shows when a received payment was expected. */
export function expectedSchedule(inv: ExpectInvoice, context?: Partial<ExpectContext> | null): ExpectedSchedule | null {
  if (inv.archivedAt) return null;
  const status = String(inv.status || "").toLowerCase();
  if (status === "void" || status === "cancelled" || status === "canceled") return null;
  if (status === "draft" && !inv.sentAt) return null;
  const settings = payExpectSettings(context?.settings);
  const houses = context?.houses || [];
  const projects = context?.projects || [];
  const jobs = context?.jobs || [];
  const overrides = new Map((context?.projectOverrides || []).map((row) => [row.projectId, row]));
  const projectId = projectForInvoice(inv, houses, projects, jobs);
  const over = projectId ? overrides.get(projectId) : undefined;
  const count = projectId ? houseCountOf(projectId, houses) : 0;
  const projectTiming = usesProjectTiming(count, over?.timing);
  const mode: DateMode = projectTiming ? (over?.dateMode || "days_after") : "days_after";
  const base = invoiceDay(inv);
  const forced = (context?.invoiceOverrides || []).find((row) => row.invoiceId === inv.id && row.part === inv.part);
  let date: string | null = null;
  let windowEnd: string | null = null;
  let estimate = false;
  let source: ExpectedSchedule["source"] = "computed";
  if (forced && jhbDate(forced.expectedOn)) {
    date = jhbDate(forced.expectedOn);
    source = "override";
  } else if (projectTiming && base) {
    const days = inv.part === "deposit"
      ? clamp(over?.depositDays, settings.projectDepositDays, 0, 365)
      : clamp(over?.finalDays, settings.projectFinalDays, 0, 365);
    const extra = clamp(over?.windowExtraDays, settings.windowExtraDays, 0, 90);
    if (mode === "days_after") {
      date = projectDateOn(base, mode, { days, dayOfMonth: 1, monthOffset: 0 });
      windowEnd = extra > 0 ? addDays(date, extra) : null;
    } else if (mode === "day_of_month" && over?.dayOfMonth) {
      date = projectDateOn(base, mode, { days, dayOfMonth: over.dayOfMonth, monthOffset: over.monthOffset ?? 0 });
    } else if (mode === "month_end") {
      date = projectDateOn(base, mode, { days, dayOfMonth: 1, monthOffset: over?.monthOffset ?? 0 });
    } else if (base) {
      date = projectDateOn(base, "days_after", { days, dayOfMonth: 1, monthOffset: 0 });
      windowEnd = extra > 0 ? addDays(date, extra) : null;
    }
  } else if (!projectTiming) {
    const days = inv.part === "deposit"
      ? clamp(over?.depositDays, settings.normalDepositDays, 0, 365)
      : clamp(over?.finalDays, settings.normalFinalDays, 0, 365);
    if (inv.part === "deposit" && base) date = addDays(base, days);
    if (inv.part === "final") {
      const done = completedDay(inv, jobs);
      if (done) date = addDays(done, days);
      else if (base) {
        date = addDays(base, days);
        estimate = true;
      }
    }
  }
  const shownEnd = source === "override" ? null : windowEnd;
  const shownEstimate = source === "override" ? false : estimate;
  return {
    date,
    windowEnd: shownEnd,
    display: date ? expectDisplay(date, shownEnd, shownEstimate) : null,
    estimate: shownEstimate,
    timing: projectTiming ? "project" : "normal",
    dateMode: projectTiming ? mode : null,
    source,
  };
}

export function computeExpectedLines(input: {
  companyId: string;
  invoices: ExpectInvoice[];
  /** Quotes that already have an invoice, including a paid or draft one. */
  invoicedQuoteIds?: string[];
  context?: Partial<ExpectContext> | null;
}): ComputedExpectLine[] {
  const settings = payExpectSettings(input.context?.settings);
  const houses = input.context?.houses || [];
  const projects = input.context?.projects || [];
  const jobs = input.context?.jobs || [];
  const overrides = new Map((input.context?.projectOverrides || []).map((row) => [row.projectId, row]));
  const out: ComputedExpectLine[] = [];

  for (const inv of input.invoices) {
    if (inv.companyId && inv.companyId !== input.companyId) continue;
    if (skipped(inv)) continue;
    const scheduled = expectedSchedule(inv, input.context);
    if (!scheduled) continue;
    out.push(lineOf({
      invoiceId: inv.id,
      quoteId: inv.quoteId || null,
      part: inv.part,
      amount: Math.round(inv.balance * 100) / 100,
      date: scheduled.date,
      windowEnd: scheduled.windowEnd,
      label: `${inv.invoiceNumber || "Invoice"} · ${inv.customerName || "Client"}`,
      href: `/admin/invoices/${inv.id}`,
      display: scheduled.display,
      estimate: scheduled.estimate,
      timing: scheduled.timing,
      dateMode: scheduled.dateMode,
      source: scheduled.source,
    }));
  }

  const quoted = new Set(input.invoicedQuoteIds || input.invoices.map((inv) => liveQuoteId(inv)).filter((id): id is string => !!id));
  for (const quote of input.context?.quotes || []) {
    if (quote.companyId && quote.companyId !== input.companyId) continue;
    if (quote.archivedAt) continue;
    const accepted = jhbDate(quote.acceptedAt);
    const acceptedStatus = String(quote.status || "").toLowerCase() === "accepted" || !!accepted;
    if (!acceptedStatus || !accepted || quoted.has(quote.id)) continue;
    const named = jobs.filter((job) => job.quoteId === quote.id);
    let projectId: string | null = null;
    for (const job of named) {
      projectId = projectFromJob(job, houses, projects);
      if (projectId) break;
    }
    const over = projectId ? overrides.get(projectId) : undefined;
    const count = projectId ? houseCountOf(projectId, houses) : 0;
    if (usesProjectTiming(count, over?.timing)) continue;
    const days = clamp(over?.depositDays, settings.normalDepositDays, 0, 365);
    const total = Number(quote.total) || 0;
    const amount = Math.round(total * depositPct(quote.paymentPlan, input.context?.defaultDepositPct ?? null)) / 100;
    if (!(amount > 0)) continue;
    const date = addDays(accepted, days);
    out.push({
      invoiceId: "",
      quoteId: quote.id,
      part: "deposit",
      amount,
      date,
      windowEnd: null,
      label: `${quote.quoteNumber || "Quote"} · ${quote.customerName || "Client"} · deposit not invoiced`,
      href: `/admin/estimates/${quote.id}`,
      display: expectDisplay(date, null, false),
      estimate: false,
      timing: "normal",
      dateMode: null,
      source: "acceptance",
    });
  }
  return out;
}

export function toAutoExpected(lines: ComputedExpectLine[]): AutoExpected[] {
  return lines.map((line) => ({
    invoiceId: line.invoiceId,
    quoteId: line.quoteId,
    part: line.part,
    amount: line.amount,
    date: line.date,
    label: line.label,
    href: line.href,
    display: line.display,
  }));
}

export function expectInvoiceFromHome(inv: HomeInvoice, part: "deposit" | "final", balance: number): ExpectInvoice {
  const row = inv as HomeInvoice & { project_house_id?: string | null; customer_id?: string | null; lead_id?: string | null };
  return {
    id: inv.id,
    companyId: inv.company_id,
    status: inv.status,
    archivedAt: inv.archived_at,
    notes: inv.notes,
    issueDate: inv.issue_date,
    sentAt: inv.sent_at,
    createdAt: inv.created_at,
    quoteId: inv.quote_id,
    leadId: row.lead_id,
    customerId: row.customer_id,
    customerName: inv.customer_name,
    invoiceNumber: inv.invoice_number,
    projectHouseId: row.project_house_id,
    balance,
    part,
  };
}
