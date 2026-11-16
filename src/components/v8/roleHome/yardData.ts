import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";
import type { AdminHomeSource } from "@/components/v8/AdminHomeFigures";
import { TEST_HVAC_ID, type HomeQuote } from "@/lib/adminHomeCount";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import type { OpenLeadInvoice } from "@/lib/openLeads";
import { fetchPayExpect } from "@/lib/payExpectApi";
import type { ExpectQuote } from "@/lib/expectedPayDates";
import { assigneeName, buildYardHome, yardFetchFrom, type YardHomeModel, type YardJob, type YardLead, type YardPresence } from "@/lib/yardView";
import type { Allocation, BankAccount, BankBalance, Commitment, Receipt } from "@/lib/cashHealth";
import { refreshOnVisit } from "@/lib/queryDefaults";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function customerName(row: { customers?: { name?: string | null } | { name?: string | null }[] | null }): string | null {
  const customer = row.customers;
  const name = Array.isArray(customer) ? customer[0]?.name : customer?.name;
  return name || null;
}

const JOB_COLS = "id, company_id, job_type, title, status, scheduled_for, started_at, completed_at, en_route_at, created_at, created_by, address, customers(name), assignments(status, created_at, profiles!assignments_profile_id_fkey(full_name))";

function asJob(row: Record<string, unknown>): YardJob {
  return {
    id: String(row.id),
    company_id: (row.company_id as string | null) ?? null,
    job_type: (row.job_type as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    scheduled_for: (row.scheduled_for as string | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    en_route_at: (row.en_route_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    customer_name: customerName(row as { customers?: { name?: string | null } | null }),
    assignee_name: assigneeName(row.assignments as Parameters<typeof assigneeName>[0]),
  };
}

async function loadJobs(companyId: string): Promise<{ jobs: YardJob[]; presence: YardPresence[] }> {
  const from = yardFetchFrom();
  const today = todayInJohannesburg();
  const [dated, open, presenceRes] = await Promise.all([
    db.from("jobs").select(JOB_COLS).eq("company_id", companyId).or(`scheduled_for.gte.${from},started_at.gte.${from},completed_at.gte.${from},created_at.gte.${from}`).limit(2000),
    db.from("jobs").select(JOB_COLS).eq("company_id", companyId).in("status", ["in_progress", "dispatched"]).limit(500),
    db.from("presence_visits").select("job_id, en_route_at, arrived_at, left_at, company_id").eq("company_id", companyId).eq("visit_date", today).limit(500),
  ]);
  if (dated.error) throw dated.error;
  if (open.error) throw open.error;
  const merged = new Map<string, YardJob>();
  for (const row of [...(dated.data || []), ...(open.data || [])] as Record<string, unknown>[]) merged.set(String(row.id), asJob(row));
  const presence = presenceRes.error ? [] : ((presenceRes.data || []) as YardPresence[]).filter((row) => row.job_id);
  const missing = [...new Set(presence.map((row) => row.job_id).filter((id): id is string => !!id && !merged.has(id)))];
  if (missing.length) {
    const extra = await db.from("jobs").select(JOB_COLS).eq("company_id", companyId).in("id", missing);
    if (extra.error) throw extra.error;
    for (const row of (extra.data || []) as Record<string, unknown>[]) merged.set(String(row.id), asJob(row));
  }
  return { jobs: [...merged.values()], presence };
}

const LEAD_COLS = "id, company_id, status, customer_name, primary_intent, service_type, deleted_at, merged_into_id, assigned_agent_id, created_at, last_activity_at";

/** Pending leads. archived_at is optional until the lead-archive migration is applied. */
async function loadPendingLeads(companyId: string): Promise<YardLead[]> {
  const withArchive = await db.from("leads").select(`${LEAD_COLS}, archived_at`).eq("company_id", companyId).eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).is("archived_at", null).limit(1000);
  if (!withArchive.error) return (withArchive.data || []) as YardLead[];
  const missing = /archived_at/i.test(String(withArchive.error.message || withArchive.error.details || ""));
  if (!missing) throw withArchive.error;
  const plain = await db.from("leads").select(LEAD_COLS).eq("company_id", companyId).eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).limit(1000);
  if (plain.error) throw plain.error;
  return (plain.data || []) as YardLead[];
}

async function loadSales(companyId: string): Promise<{ leads: YardLead[]; quotes: HomeQuote[]; quoteJobs: { quote_id: string | null; lead_id: string | null; invoice_id: string | null; status: string | null; company_id: string; created_at?: string | null }[]; leadInvoices: OpenLeadInvoice[]; leadIntent: Record<string, string | null>; leadService: Record<string, string | null>; leadClosure: Record<string, { closed_at: string | null; dismissed_at: string | null }> }> {
  const jobCols = "id, quote_id, lead_id, invoice_id, status, company_id, created_at";
  const invCols = "id, quote_id, lead_id, status, archived_at";
  const [quotesRes, leads, jobsByQuote, jobsByInvoice, invByQuote, invByLead] = await Promise.all([
    db.from("quotes").select("id, company_id, status, total, created_at, sent_at, viewed_at, accepted_at, declined_at, updated_at, valid_until, lead_id, sales_engineer_id, quote_number, customer_name, customer_id, archived_at, option_group_id, option_label, option_chosen_id, payment_plan").eq("company_id", companyId).is("archived_at", null).neq("status", "superseded").limit(1000),
    loadPendingLeads(companyId),
    db.from("jobs").select(jobCols).eq("company_id", companyId).not("quote_id", "is", null).limit(2000),
    db.from("jobs").select(jobCols).eq("company_id", companyId).not("invoice_id", "is", null).limit(2000),
    db.from("invoices").select(invCols).eq("company_id", companyId).not("quote_id", "is", null).limit(2000),
    db.from("invoices").select(invCols).eq("company_id", companyId).not("lead_id", "is", null).limit(2000),
  ]);
  if (quotesRes.error) throw quotesRes.error;
  if (jobsByQuote.error) throw jobsByQuote.error;
  if (jobsByInvoice.error) throw jobsByInvoice.error;
  if (invByQuote.error) throw invByQuote.error;
  if (invByLead.error) throw invByLead.error;
  const invoiceRows = new Map<string, OpenLeadInvoice>();
  for (const row of [...(invByQuote.data || []), ...(invByLead.data || [])] as OpenLeadInvoice[]) {
    if (row.id) invoiceRows.set(row.id, row);
  }
  const jobRows = new Map<string, { quote_id: string | null; lead_id: string | null; invoice_id: string | null; status: string | null; company_id: string; created_at?: string | null }>();
  for (const row of [...(jobsByQuote.data || []), ...(jobsByInvoice.data || [])] as { id: string; quote_id: string | null; lead_id: string | null; invoice_id: string | null; status: string | null; company_id: string; created_at?: string | null }[]) {
    jobRows.set(row.id, row);
  }
  const quotes = (quotesRes.data || []) as HomeQuote[];
  const leadIds = [...new Set(quotes.map((quote) => quote.lead_id).filter((id): id is string => !!id))];
  let leadIntent: Record<string, string | null> = {};
  let leadService: Record<string, string | null> = {};
  let leadClosure: Record<string, { closed_at: string | null; dismissed_at: string | null }> = {};
  if (leadIds.length) {
    const intentRes = await db.from("leads").select("id, primary_intent, service_type, company_id, closed_at, dismissed_at").eq("company_id", companyId).in("id", leadIds);
    if (intentRes.error) throw intentRes.error;
    const rows = (intentRes.data || []) as { id: string; primary_intent: string | null; service_type: string | null; closed_at: string | null; dismissed_at: string | null }[];
    leadIntent = Object.fromEntries(rows.map((row) => [row.id, row.primary_intent]));
    leadService = Object.fromEntries(rows.map((row) => [row.id, row.service_type]));
    leadClosure = Object.fromEntries(rows.map((row) => [row.id, { closed_at: row.closed_at, dismissed_at: row.dismissed_at }]));
  }
  return {
    leads,
    quotes,
    quoteJobs: [...jobRows.values()],
    leadInvoices: [...invoiceRows.values()],
    leadIntent,
    leadService,
    leadClosure,
  };
}

async function loadBooks(companyId: string): Promise<{ accounts: BankAccount[]; balances: BankBalance[]; receipts: Receipt[]; commitments: Commitment[]; allocations: Allocation[] }> {
  const [accounts, balances, receipts, commitments, allocations] = await Promise.all([
    db.from("cf_bank_accounts").select("id, label, account_ref, include, sort").eq("company_id", companyId),
    db.from("cf_bank_balances").select("id, account_id, balance, as_of, created_at, source, note").eq("company_id", companyId).order("as_of", { ascending: false }).limit(200),
    db.from("cf_receipts").select("id, source, invoice_id, quote_id, ref, client, part, amount_incl, vat_incl, expected_date, leeway_days, confidence, status, received_date, note").eq("company_id", companyId).limit(2000),
    db.from("cf_commitments").select("id, source_key, invoice_id, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, vat_rate, status, pay_date, note").eq("company_id", companyId).limit(2000),
    db.from("cf_stock_allocations").select("id, stock_item_id, commitment_id, qty, drawn_at").eq("company_id", companyId).limit(2000),
  ]);
  const error = accounts.error || balances.error || receipts.error || commitments.error || allocations.error;
  if (error) throw error;
  return {
    accounts: (accounts.data || []) as BankAccount[],
    balances: (balances.data || []) as BankBalance[],
    receipts: (receipts.data || []) as Receipt[],
    commitments: (commitments.data || []) as Commitment[],
    allocations: (allocations.data || []) as Allocation[],
  };
}

export function useYardHome(companyId: string | null | undefined, source: AdminHomeSource | undefined, figuresLoading: boolean) {
  const enabled = !!companyId && companyId !== TEST_HVAC_ID;
  const profile = useDocumentCompanyProfile(enabled ? companyId : null);
  const settings = useCompanySettings();
  const jobs = useQuery({
    queryKey: ["yard-jobs", companyId],
    enabled,
    ...refreshOnVisit,
    refetchInterval: 60_000,
    queryFn: () => loadJobs(companyId as string),
  });
  const sales = useQuery({
    queryKey: ["yard-sales", companyId],
    enabled,
    ...refreshOnVisit,
    refetchInterval: 60_000,
    queryFn: () => loadSales(companyId as string),
  });
  const aging = useQuery({
    queryKey: ["yard-aging", companyId],
    enabled,
    ...refreshOnVisit,
    queryFn: async () => {
      const { data, error } = await db.from("sales_automation_settings").select("cold_after_days, archive_after_days").eq("company_id", companyId).maybeSingle();
      if (error) return { warn: 30, archive: 60 };
      const row = data as { cold_after_days?: number | null; archive_after_days?: number | null } | null;
      return { warn: row?.cold_after_days ?? 30, archive: row?.archive_after_days ?? 60 };
    },
  });
  const books = useQuery({
    queryKey: ["yard-books", companyId],
    enabled,
    ...refreshOnVisit,
    refetchInterval: 60_000,
    queryFn: () => loadBooks(companyId as string),
  });
  const expectQ = useQuery({
    queryKey: ["pay-expect", companyId, source?.invoices?.length ?? 0, sales.data?.quotes?.length ?? 0],
    enabled: enabled && !!source,
    ...refreshOnVisit,
    refetchInterval: 60_000,
    queryFn: () => {
      const invoices = source?.invoices || [];
      const quotes = sales.data?.quotes || [];
      return fetchPayExpect({
        companyId: companyId as string,
        invoiceIds: invoices.map((row) => row.id),
        quoteIds: [...new Set(invoices.map((row) => row.quote_id).filter((id): id is string => !!id))],
        leadIds: [...new Set(invoices.map((row) => row.lead_id).filter((id): id is string => !!id))],
        quotes: quotes.map((quote): ExpectQuote => ({
          id: quote.id,
          companyId: quote.company_id,
          status: quote.status,
          archivedAt: quote.archived_at,
          acceptedAt: quote.accepted_at,
          total: quote.total,
          customerId: quote.customer_id,
          customerName: quote.customer_name,
          quoteNumber: quote.quote_number,
          paymentPlan: quote.payment_plan,
        })),
        defaultDepositPct: settings.settings.default_deposit_percentage ?? null,
      });
    },
  });
  const companyName = profile?.legal_name || settings.settings.company_name || "";
  const ready = enabled && !!source && jobs.isFetched && sales.isFetched;
  const model = useMemo<YardHomeModel | null>(() => {
    if (!ready || !companyId || !source) return null;
    const bankState = books.isError ? "error" : books.data ? "ready" : "loading";
    return buildYardHome({
      companyId,
      invoices: source.invoices,
      payments: source.payments,
      credits: source.credits,
      jobs: jobs.data?.jobs || [],
      presence: jobs.data?.presence || [],
      leads: sales.data?.leads || [],
      quotes: sales.data?.quotes || [],
      quoteJobs: sales.data?.quoteJobs || [],
      leadInvoices: sales.data?.leadInvoices || [],
      leadIntent: sales.data?.leadIntent || {},
      leadService: sales.data?.leadService || {},
      leadClosure: sales.data?.leadClosure || {},
      warnAfterDays: aging.data?.warn ?? 30,
      bank: books.data ? { accounts: books.data.accounts, balances: books.data.balances } : null,
      bankState,
      books: books.data ? { receipts: books.data.receipts, commitments: books.data.commitments, allocations: books.data.allocations } : null,
      booksState: bankState,
      expect: expectQ.data && !expectQ.error ? expectQ.data : null,
    });
  }, [ready, companyId, source, jobs.data, sales.data, books.data, books.isError, aging.data, expectQ.data, expectQ.error]);
  const error = !!jobs.error || !!sales.error;
  return { companyName, model, loading: figuresLoading || (!!enabled && !ready && !error), error };
}
