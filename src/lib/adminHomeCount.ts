/**
 * Admin home figures (pies + "How this was counted").
 * Pure: the signed-in company is the only company that counts.
 * Massair CT must not pick up Massair Ind CC or Test HVAC rows.
 * Call-out fees are never subtracted from a quote or invoice amount.
 */
import { fmtDay, fmtDayTime } from "@/lib/balanceDue";
import { jhbDate } from "@/lib/drilldown";
import { kindOfJobType } from "@/lib/jobTypeChoice";
import { invoiceMoney, type MoneyPayment } from "@/lib/moneySummary";
import { isSettledPayment } from "@/lib/payments";
import { fmtRandShort, buildDeals, type PipeInvoice, type PipeJob } from "@/lib/quotePipeline";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { isUnpaid } from "@/lib/unpaidBuckets";

export const MASSAIR_CT_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
export const MASSAIR_IND_ID = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
/** Hidden on this home even if it is the signed-in company. */
export const TEST_HVAC_ID = "4ddd72cb-56b9-448a-a589-3490bbc464ae";

const VOID = new Set(["void", "cancelled", "canceled"]);
const CALL_OUT_RULE = "The call-out fee is never deducted.";

export function inSignedInCompany(rowCompanyId: string | null | undefined, signedInCompanyId: string | null | undefined): boolean {
  if (!signedInCompanyId || !rowCompanyId) return false;
  if (rowCompanyId === TEST_HVAC_ID) return false;
  return rowCompanyId === signedInCompanyId;
}

/** Johannesburg YYYY-MM. Date-only strings stay on that calendar day. */
export function jhbMonth(value?: string | null): string | null {
  const d = jhbDate(value);
  return d ? d.slice(0, 7) : null;
}

export function currentJhbMonth(now = new Date()): string {
  return todayInJohannesburg(now).slice(0, 7);
}

export function previousJhbMonth(now = new Date()): string {
  const [y, m] = currentJhbMonth(now).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthChangePct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Legend / tile rand, grouped, no cents: R42 500. */
export function fmtHomeRand(n: number): string {
  const r = Math.round(Number(n) || 0);
  const sign = r < 0 ? "-" : "";
  const body = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R${body}`;
}

export interface CountLine {
  id: string;
  label: string;
  amount: number;
  href: string;
}

export interface CountFigure {
  key: string;
  title: string;
  rule: string;
  lines: CountLine[];
  total: number;
  count: number;
  unit: "money" | "jobs";
  actionLabel: string;
  actionHref: string;
}

export interface HomeInvoice {
  id: string;
  company_id?: string | null;
  status?: string | null;
  grand_total?: number | string | null;
  notes?: string | null;
  sent_at?: string | null;
  archived_at?: string | null;
  customer_name?: string | null;
  invoice_number?: string | null;
  quote_id?: string | null;
  /** Present on some rows. Ignored: never subtracted. */
  call_out_excl_vat?: number | null;
  created_at?: string | null;
  /** Stored payment dates. The yard view reads these; counting ignores them. */
  due_date?: string | null;
  due_date_manual?: boolean | null;
  due_date_source?: string | null;
  expected_deposit_date?: string | null;
  expected_final_date?: string | null;
  final_unscheduled?: boolean | null;
  issue_date?: string | null;
}

export interface HomePayment {
  id?: string;
  invoice_id: string;
  company_id?: string | null;
  amount: number | string;
  status?: string | null;
  gateway?: string | null;
  payment_date?: string | null;
}

export interface HomeCredit {
  invoice_id: string;
  total: number | string;
  status?: string | null;
}

export interface HomeJob {
  id: string;
  company_id?: string | null;
  job_type?: string | null;
  title?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  customer_name?: string | null;
}

export interface HomeQuote {
  id: string;
  company_id?: string | null;
  status: string | null;
  total: number | string | null;
  created_at: string;
  sent_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  updated_at?: string | null;
  valid_until?: string | null;
  lead_id?: string | null;
  sales_engineer_id?: string | null;
  option_group_id?: string | null;
  option_label?: string | null;
  option_chosen_id?: string | null;
  quote_number?: string | null;
  customer_name?: string | null;
  archived_at?: string | null;
  call_out_excl_vat?: number | null;
}

export type WorkKind = "service" | "installation" | "move" | "other";

export const WORK_LABEL: Record<WorkKind, string> = {
  service: "Service / repair",
  installation: "Installation",
  move: "Move",
  other: "Other",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const statusOf = (s?: string | null) => String(s || "").toLowerCase();

function figure(part: Omit<CountFigure, "total" | "count" | "lines"> & { lines: CountLine[] }): CountFigure {
  const lines = [...part.lines].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  return { ...part, lines, count: lines.length, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}

function grandOf(inv: HomeInvoice): number {
  const n = Number(inv.grand_total);
  return Number.isFinite(n) ? r2(n) : 0;
}

function invoiceLabel(inv: HomeInvoice): string {
  return `${inv.invoice_number || "Invoice"} · ${inv.customer_name || "Client"}`;
}

function usableInvoice(inv: HomeInvoice, companyId: string): boolean {
  return inSignedInCompany(inv.company_id, companyId) && !inv.archived_at && !VOID.has(statusOf(inv.status));
}

/** Draft, and not emailed yet. */
export function isWaitingToSend(inv: Pick<HomeInvoice, "status" | "sent_at">): boolean {
  return statusOf(inv.status) === "draft" && !inv.sent_at;
}

export function isDepositInvoiceNote(notes?: string | null): boolean {
  return (notes ?? "").trim().toUpperCase().startsWith("DEPOSIT");
}

export function waitingRule(n: number): string {
  const head = n === 1 ? "1 draft invoice that has" : `${n} draft invoices that have`;
  return `${head} not been emailed yet, amounts incl. VAT. ${CALL_OUT_RULE}`;
}

/**
 * Scheduled date wins. Without one, the started, completed, then created date.
 * That is the month the job is counted in.
 */
export function jobWorkAt(job: Pick<HomeJob, "scheduled_for" | "started_at" | "completed_at" | "created_at">): string | null {
  return job.scheduled_for || job.started_at || job.completed_at || job.created_at || null;
}

/** Service / repair, installation, or move. Anything else is Other so the centre still adds up. */
export function workKindOf(job: { job_type?: string | null; title?: string | null }): WorkKind {
  const blob = `${job.job_type || ""} ${job.title || ""}`.toLowerCase();
  if (/\bmoves?\b|reloc/.test(blob)) return "move";
  const kind = kindOfJobType(job.job_type);
  if (kind === "service") return "service";
  if (kind === "installation") return "installation";
  if (/repair|service|maintenance|call/.test(blob)) return "service";
  if (/install/.test(blob)) return "installation";
  return "other";
}

function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { month: "long", timeZone: "UTC" });
}

export interface AdminHomeCounts {
  waiting: CountFigure;
  deposit: CountFigure;
  finalDue: CountFigure;
  paid: CountFigure;
  money: CountFigure;
  owed: CountFigure;
  owedByQuote: Record<string, number>;
  accepted: CountFigure;
  previousAccepted: number;
  open: CountFigure;
  draftsNotSent: number;
  work: CountFigure;
  workSlices: { key: WorkKind; label: string; figure: CountFigure }[];
}

export function countAdminHome(input: {
  companyId: string;
  now?: Date;
  invoices?: HomeInvoice[];
  payments?: HomePayment[];
  credits?: HomeCredit[];
  jobs?: HomeJob[];
  quotes?: HomeQuote[];
  quoteInvoices?: PipeInvoice[];
  quoteJobs?: PipeJob[];
}): AdminHomeCounts {
  const now = input.now ?? new Date();
  const companyId = input.companyId;
  const month = currentJhbMonth(now);
  const prevMonth = previousJhbMonth(now);
  const invoices = (input.invoices || []).filter((inv) => usableInvoice(inv, companyId));
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const payments = (input.payments || []).filter((p) => {
    if (!byId.has(p.invoice_id)) return false;
    if (p.company_id && !inSignedInCompany(p.company_id, companyId)) return false;
    return isSettledPayment(p);
  });
  const credits = (input.credits || []).filter((c) => byId.has(c.invoice_id));
  const paysFor = (id: string): MoneyPayment[] => payments.filter((p) => p.invoice_id === id).map((p) => ({ invoice_id: p.invoice_id, amount: p.amount, status: p.status, gateway: p.gateway }));
  const creditFor = (id: string) => credits.filter((c) => c.invoice_id === id).map((c) => ({ invoice_id: c.invoice_id, total: c.total, status: c.status }));
  const balanceOf = (inv: HomeInvoice) => invoiceMoney(
    { id: inv.id, status: inv.status ?? null, grand_total: grandOf(inv), notes: inv.notes, quote_id: inv.quote_id ?? null },
    paysFor(inv.id),
    creditFor(inv.id),
  ).balance;

  const waitingLines: CountLine[] = [];
  const depositLines: CountLine[] = [];
  const finalLines: CountLine[] = [];
  const owedLines: CountLine[] = [];
  const owedByQuote: Record<string, number> = {};
  for (const inv of invoices) {
    const href = `/admin/invoices/${inv.id}`;
    if (isWaitingToSend(inv)) {
      waitingLines.push({ id: inv.id, label: invoiceLabel(inv), amount: grandOf(inv), href });
      continue;
    }
    // A draft that already has sent_at was emailed; it is no longer "waiting to send".
    const issuedStatus = statusOf(inv.status) === "draft" && inv.sent_at ? "sent" : inv.status;
    const balance = balanceOf(inv);
    if (!isUnpaid(issuedStatus, balance)) continue;
    const line = { id: inv.id, label: invoiceLabel(inv), amount: balance, href };
    owedLines.push(line);
    if (inv.quote_id) owedByQuote[inv.quote_id] = r2((owedByQuote[inv.quote_id] || 0) + balance);
    if (isDepositInvoiceNote(inv.notes)) depositLines.push(line);
    else finalLines.push(line);
  }

  const paidLines: CountLine[] = [];
  payments.forEach((p, i) => {
    const when = jhbMonth(p.payment_date);
    if (when !== month) return;
    const inv = byId.get(p.invoice_id)!;
    const amount = r2(Number(p.amount) || 0);
    if (!(amount > 0)) return;
    paidLines.push({
      id: p.id || `${p.invoice_id}:${i}`,
      label: `Paid · ${invoiceLabel(inv)}`,
      amount,
      href: `/admin/invoices/${inv.id}`,
    });
  });

  const waiting = figure({
    key: "waiting", title: "Invoices waiting to send", unit: "money",
    rule: waitingRule(waitingLines.length),
    actionLabel: "Review & send", actionHref: "/admin/invoices?state=draft",
    lines: waitingLines,
  });
  // Rule uses the final count (after sort, same length).
  waiting.rule = waitingRule(waiting.count);

  const deposit = figure({
    key: "deposit", title: "Deposit due", unit: "money",
    rule: `Deposit invoices with a balance still owing, incl. VAT. Drafts that have not been emailed are counted in Waiting to send instead. ${CALL_OUT_RULE}`,
    actionLabel: "Open deposits", actionHref: "/admin/invoices?money=deposits_due",
    lines: depositLines,
  });
  const finalDue = figure({
    key: "final", title: "Final due", unit: "money",
    rule: `Unpaid invoices that are not deposits, balance still owing after settled payments and issued credit notes, incl. VAT. Drafts are not included. ${CALL_OUT_RULE}`,
    actionLabel: "Open unpaid", actionHref: "/admin/invoices?state=unpaid",
    lines: finalLines,
  });
  const paid = figure({
    key: "paid", title: "Paid this month", unit: "money",
    rule: `Payments settled in ${monthName(month)}, on this company's invoices, incl. VAT. Pending payments are not included. ${CALL_OUT_RULE}`,
    actionLabel: "Open paid", actionHref: `/admin/invoices?state=paid&period=${month}`,
    lines: paidLines,
  });
  const money = figure({
    key: "money", title: "Where the money sits", unit: "money",
    rule: `Waiting to send, plus deposit still due, plus final balance still due, plus payments settled in ${monthName(month)}. Amounts incl. VAT. ${CALL_OUT_RULE}`,
    actionLabel: "Open invoices", actionHref: "/admin/invoices",
    lines: [
      ...waiting.lines.map((l) => ({ ...l, id: `w:${l.id}`, label: `Waiting · ${l.label}` })),
      ...deposit.lines.map((l) => ({ ...l, id: `d:${l.id}`, label: `Deposit · ${l.label}` })),
      ...finalDue.lines.map((l) => ({ ...l, id: `f:${l.id}`, label: `Final · ${l.label}` })),
      ...paid.lines.map((l) => ({ ...l, id: `p:${l.id}` })),
    ],
  });
  const owed = figure({
    key: "owed", title: "Owed on unpaid invoices", unit: "money",
    rule: `Unpaid invoices of any date, balance still owing after settled payments and issued credit notes, incl. VAT. Drafts are not included. ${CALL_OUT_RULE}`,
    actionLabel: "Open unpaid", actionHref: "/admin/invoices?state=unpaid",
    lines: owedLines,
  });

  const quotes = (input.quotes || []).filter((q) => inSignedInCompany(q.company_id, companyId) && !q.archived_at);
  const deals = buildDeals(quotes, input.quoteInvoices || [], input.quoteJobs || [], now);
  const acceptedLines: CountLine[] = [];
  const openLines: CountLine[] = [];
  let previousAccepted = 0;
  let draftsNotSent = 0;
  for (const d of deals) {
    if (d.stage === "draft") { draftsNotSent += 1; continue; }
    const q = d.quote as HomeQuote;
    const href = `/admin/estimates/${q.id}`;
    const label = `${q.quote_number || "Quote"} · ${q.customer_name || "Client"}`;
    const accMonth = q.accepted_at ? jhbMonth(q.accepted_at) : null;
    if (accMonth === month) acceptedLines.push({ id: q.id, label, amount: r2(d.value), href });
    else if (accMonth === prevMonth) previousAccepted = r2(previousAccepted + d.value);
    if (d.stage === "sent" || d.stage === "viewed") openLines.push({ id: q.id, label, amount: r2(d.value), href });
  }
  const accepted = figure({
    key: "accepted", title: `Quotes accepted in ${monthName(month)}`, unit: "money",
    rule: `Quotes accepted in ${monthName(month)}, by the accepted date, amounts incl. VAT. Option groups count once. A job booked later still counts in the month it was accepted. ${CALL_OUT_RULE}`,
    actionLabel: "Open pipeline", actionHref: "/admin/jobs?tab=pipeline",
    lines: acceptedLines,
  });
  const open = figure({
    key: "open", title: "Open quotes", unit: "money",
    rule: `Quotes that are sent or viewed and not accepted yet, amounts incl. VAT. Drafts are counted apart and are not in this total. Option groups count once. ${CALL_OUT_RULE}`,
    actionLabel: "Open quotes", actionHref: "/admin/quotes?status=sent,viewed&type=estimate",
    lines: openLines,
  });

  const workLines: Record<WorkKind, CountLine[]> = { service: [], installation: [], move: [], other: [] };
  for (const job of input.jobs || []) {
    if (!inSignedInCompany(job.company_id, companyId)) continue;
    if (VOID.has(statusOf(job.status))) continue;
    if (jhbMonth(jobWorkAt(job)) !== month) continue;
    const kind = workKindOf(job);
    const who = job.customer_name || "Client";
    workLines[kind].push({
      id: job.id,
      label: `${job.title || WORK_LABEL[kind]} · ${who}`,
      amount: 1,
      href: `/admin/jobs/${job.id}`,
    });
  }
  const sliceFigure = (key: WorkKind): CountFigure => figure({
    key: `work-${key}`, title: WORK_LABEL[key], unit: "jobs",
    rule: key === "other"
      ? `Jobs this month that are not service / repair, installation, or move. Cancelled jobs are left out. The month is the scheduled date, or the started, completed or created date when there is no schedule.`
      : `${WORK_LABEL[key]} jobs this month. Cancelled jobs are left out. The month is the scheduled date, or the started, completed or created date when there is no schedule.`,
    actionLabel: "Open schedule", actionHref: "/admin/schedule",
    lines: workLines[key],
  });
  const order: WorkKind[] = ["service", "installation", "move", "other"];
  const workSlices = order.map((key) => ({ key, label: WORK_LABEL[key], figure: sliceFigure(key) })).filter((s) => s.key !== "other" || s.figure.count > 0);
  const work = figure({
    key: "work", title: "This month's work", unit: "jobs",
    rule: `Jobs in ${monthName(month)} that are not cancelled. The month is the scheduled date, or the started, completed or created date when there is no schedule. Service / repair, installation and move are counted apart.`,
    actionLabel: "Open schedule", actionHref: "/admin/schedule",
    lines: workSlices.flatMap((s) => s.figure.lines.map((l) => ({ ...l, id: `${s.key}:${l.id}`, label: `${s.label} · ${l.label}` }))),
  });

  return { waiting, deposit, finalDue, paid, money, owed, owedByQuote, accepted, previousAccepted, open, draftsNotSent, work, workSlices };
}

/** One line under an expanded "Then, in order" row. View count is not stored — last viewed time is. */
export function thenInOrderDetail(q: { sent_at?: string | null; viewed_at?: string | null }, value: number): string {
  const bits: string[] = [];
  if (q.sent_at) bits.push(`Sent ${fmtDay(q.sent_at)}`);
  if (q.viewed_at) bits.push(`last viewed ${fmtDayTime(q.viewed_at)}`);
  else if (q.sent_at) bits.push("not viewed yet");
  bits.push(`${fmtRandShort(value)} incl. VAT`);
  return bits.join(" · ");
}
