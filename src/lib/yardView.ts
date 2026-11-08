/**
 * Yard view, on /admin/yard. Admin Home reuses the money tiles only.
 * Counting stays pure so the picture and the tests share one rule.
 *
 * Work in motion follows public._job_stage (sales "My jobs"), narrowed to current work:
 * - Waiting to leave: scheduled today (Johannesburg), not started, not en route.
 * - On the way: status dispatched, or en_route_at set, or today's presence says en route, and the job has not started.
 * - On site: started_at set, status in_progress / on_site, or today's presence has arrived and not left.
 * - Done: completed today. completed_at is the day. A completed status with no completed_at is left out
 *   (the day is not invented). Older completed jobs are not in the picture.
 * A stage with no jobs has no van. Cancelled jobs are left out. Another company never counts.
 *
 * Today / this week / this month use jobWorkAt, the same date as "this month's work":
 * scheduled date, else started, else completed, else created. Week is Monday–Sunday in Johannesburg.
 *
 * Money amounts reuse countAdminHome (deposit balance, final balance). Dates are stored only:
 * expected_deposit_date / expected_final_date, else a due date. A hand-set due date
 * (due_date_source manual or due_date_manual) is an expected date. A terms due date is shown as due.
 * Issue date plus terms is not calculated here. final_unscheduled with no date is "Due on completion".
 * Cash on hand and liabilities reuse cash-health startBalance and jobLiabilities. No balance is invented.
 */
import { fmtDay } from "@/lib/balanceDue";
import { jobLiabilities, latestBalances, projects, startBalance, stillToPay, type Allocation, type BankAccount, type BankBalance, type Commitment, type Receipt } from "@/lib/cashHealth";
import { jhbDate } from "@/lib/drilldown";
import { countAdminHome, fmtHomeRand, inSignedInCompany, jobWorkAt, type HomeInvoice, type HomeJob, type HomeQuote } from "@/lib/adminHomeCount";
import { buildDeals, type PipeJob } from "@/lib/quotePipeline";
import { areaFromAddress, jobTypeWord } from "@/lib/roleHome";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { formatRand } from "@/utils/formatRand";

export type YardStage = "waiting" | "en_route" | "on_site" | "done";

export const YARD_STAGE_META: { key: YardStage; place: string; caption: string }[] = [
  { key: "waiting", place: "The yard", caption: "Waiting to leave" },
  { key: "en_route", place: "En route", caption: "On the way" },
  { key: "on_site", place: "On site", caption: "On site" },
  { key: "done", place: "Done", caption: "Done" },
];

const CANCELLED = new Set(["cancelled", "canceled", "void"]);
const DONE_STATUS = new Set(["completed", "invoiced", "closed"]);
const REJECTED_ASSIGN = new Set(["rejected", "declined", "cancelled", "canceled"]);

export const YARD_LINKS = {
  invoicesDraft: "/admin/invoices?state=draft",
  deposits: "/admin/invoices?money=deposits_due",
  finals: "/admin/invoices?state=unpaid",
  cash: "/admin/cash-health",
  liabilities: "/admin/cash-health",
  openLeads: "/admin/jobs?tab=pipeline",
  newLead: "/admin/dispatch?inbox=1",
  quoting: "/admin/quotes?status=draft&type=estimate",
  waitingCustomer: "/admin/quotes?status=sent,viewed&type=estimate",
  booked: "/admin/jobs?tab=pipeline",
  jobsToday: "/admin/jobs/dispatch?date=today",
  jobsWeek: "/admin/schedule",
  jobsMonth: "/admin/schedule",
  job: (id: string) => `/admin/jobs/${id}`,
};

export interface YardPresence {
  job_id: string | null;
  en_route_at?: string | null;
  arrived_at?: string | null;
  left_at?: string | null;
}

export interface YardJob extends HomeJob {
  en_route_at?: string | null;
  assignee_name?: string | null;
  address?: string | null;
  /** Ignored. Two Johans are not one person, and attribution is not rewritten here. */
  created_by?: string | null;
}

export interface YardLead {
  id: string;
  company_id?: string | null;
  status?: string | null;
  customer_name?: string | null;
  primary_intent?: string | null;
  deleted_at?: string | null;
  merged_into_id?: string | null;
  service_type?: string | null;
}

export type PaymentTone = "expected" | "due" | "completion" | "none";

export interface PaymentWhen {
  iso: string | null;
  tone: PaymentTone;
}

export function jhbRanges(now = new Date()): { today: string; weekStart: string; weekEnd: string; month: string } {
  const today = todayInJohannesburg(now);
  const [y, m, d] = today.split("-").map(Number);
  const noonSast = new Date(Date.UTC(y, m - 1, d, 10));
  const mondayOffset = (noonSast.getUTCDay() + 6) % 7;
  const weekStart = addDays(today, -mondayOffset);
  return { today, weekStart, weekEnd: addDays(weekStart, 6), month: today.slice(0, 7) };
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Day before this Johannesburg week or month, whichever starts sooner. The yard job query uses it as a lower bound. */
export function yardFetchFrom(now = new Date()): string {
  const range = jhbRanges(now);
  const monthStart = `${range.month}-01`;
  const start = range.weekStart < monthStart ? range.weekStart : monthStart;
  return addDays(start, -1);
}

/** Johannesburg hour, 0–23. Used for the admin greeting only. */
export function jhbHour(now = new Date()): number {
  const raw = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", hourCycle: "h23" }).format(now);
  const h = Number(raw);
  return Number.isFinite(h) ? h % 24 : 0;
}

export function jhbGreetingTitle(now = new Date()): string {
  const h = jhbHour(now);
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function pickPresence(rows: YardPresence[]): Map<string, YardPresence> {
  const map = new Map<string, YardPresence>();
  const score = (p: YardPresence) => (p.arrived_at && !p.left_at ? 2 : p.en_route_at && !p.arrived_at ? 1 : 0);
  for (const row of rows) {
    if (!row.job_id) continue;
    const prev = map.get(row.job_id);
    if (!prev || score(row) >= score(prev)) map.set(row.job_id, row);
  }
  return map;
}

/** One stage, or null when the job is not in today's picture. */
export function yardStage(job: YardJob, companyId: string, today: string, presence?: YardPresence | null): YardStage | null {
  if (!inSignedInCompany(job.company_id, companyId)) return null;
  const status = String(job.status || "").toLowerCase();
  if (CANCELLED.has(status)) return null;
  const completed = !!job.completed_at || DONE_STATUS.has(status);
  if (completed) return jhbDate(job.completed_at) === today ? "done" : null;
  const arrived = !!(presence?.arrived_at && !presence.left_at);
  if (job.started_at || status === "in_progress" || status === "on_site" || arrived) return "on_site";
  const enRoute = !!(job.en_route_at || status === "dispatched" || status === "en_route" || (presence?.en_route_at && !presence.arrived_at));
  if (enRoute) return "en_route";
  if (jhbDate(job.scheduled_for) === today) return "waiting";
  return null;
}

export function yardWhen(job: Pick<YardJob, "scheduled_for" | "started_at" | "completed_at">): string {
  const iso = job.scheduled_for || job.started_at || job.completed_at;
  if (!iso) return "Time not set";
  const day = fmtDay(iso);
  if (!day) return "Time not set";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return day;
  const time = new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });
  return time ? `${day} · ${time}` : day;
}

const STAGE_WORD: Record<YardStage, string> = {
  waiting: "Waiting to leave",
  en_route: "On the way",
  on_site: "On site",
  done: "Done",
};

export function yardStatusLine(job: YardJob, stage: YardStage): string {
  const raw = String(job.status || "").trim().replace(/_/g, " ");
  return raw ? `${STAGE_WORD[stage]} · ${raw}` : STAGE_WORD[stage];
}

export interface YardJobInfo {
  id: string;
  href: string;
  customer: string;
  type: string;
  when: string;
  assignee: string;
  status: string;
  /** Suburb from the job address. Empty when the job has no address. */
  area: string | null;
}

export interface YardStageView {
  key: YardStage;
  place: string;
  caption: string;
  count: number;
  jobs: YardJobInfo[];
}

export function groupYard(jobs: YardJob[], companyId: string, now = new Date(), presence: YardPresence[] = []): YardStageView[] {
  const today = jhbRanges(now).today;
  const byJob = pickPresence(presence);
  const buckets: Record<YardStage, YardJobInfo[]> = { waiting: [], en_route: [], on_site: [], done: [] };
  const sorted = [...jobs].sort((a, b) => String(a.scheduled_for || a.started_at || "").localeCompare(String(b.scheduled_for || b.started_at || "")) || a.id.localeCompare(b.id));
  for (const job of sorted) {
    const stage = yardStage(job, companyId, today, byJob.get(job.id));
    if (!stage) continue;
    buckets[stage].push({
      id: job.id,
      href: YARD_LINKS.job(job.id),
      customer: job.customer_name || "Client",
      type: jobTypeWord(job.job_type, job.title),
      when: yardWhen(job),
      assignee: job.assignee_name || "Unassigned",
      status: yardStatusLine(job, stage),
      area: job.address?.trim() ? areaFromAddress(job.address, job.title) : null,
    });
  }
  return YARD_STAGE_META.map((meta) => ({ ...meta, count: buckets[meta.key].length, jobs: buckets[meta.key] }));
}

export function countJobPeriods(jobs: YardJob[], companyId: string, now = new Date()): { today: number; week: number; month: number } {
  const range = jhbRanges(now);
  let today = 0;
  let week = 0;
  let month = 0;
  for (const job of jobs) {
    if (!inSignedInCompany(job.company_id, companyId)) continue;
    if (CANCELLED.has(String(job.status || "").toLowerCase())) continue;
    const day = jhbDate(jobWorkAt(job));
    if (!day) continue;
    if (day === range.today) today += 1;
    if (day >= range.weekStart && day <= range.weekEnd) week += 1;
    if (day.slice(0, 7) === range.month) month += 1;
  }
  return { today, week, month };
}

function handSetDue(inv: HomeInvoice): boolean {
  return inv.due_date_source === "manual" || inv.due_date_manual === true;
}

/** A date already stored on the invoice. Never issue date + terms. */
export function paymentWhen(inv: HomeInvoice, kind: "deposit" | "final"): PaymentWhen {
  if (kind === "deposit") {
    if (inv.expected_deposit_date) return { iso: inv.expected_deposit_date, tone: "expected" };
    if (inv.due_date && handSetDue(inv)) return { iso: inv.due_date, tone: "expected" };
    if (inv.due_date) return { iso: inv.due_date, tone: "due" };
    return { iso: null, tone: "none" };
  }
  if (inv.expected_final_date) return { iso: inv.expected_final_date, tone: "expected" };
  if (inv.due_date && handSetDue(inv)) return { iso: inv.due_date, tone: "expected" };
  if (inv.final_unscheduled) return { iso: null, tone: "completion" };
  if (inv.due_date) return { iso: inv.due_date, tone: "due" };
  return { iso: null, tone: "none" };
}

export function paymentDateLabel(when: PaymentWhen): string {
  if (when.tone === "completion") return "Due on completion";
  if (!when.iso || when.tone === "none") return "Date not set";
  const day = fmtDay(when.iso);
  if (!day) return "Date not set";
  return when.tone === "expected" ? `Expected ${day}` : `Due ${day}`;
}

export function summarisePaymentDates(items: PaymentWhen[]): string {
  if (items.length === 0) return "Nothing due";
  const dated = items
    .map((item, index) => ({ item, index, day: item.iso && item.tone !== "completion" && item.tone !== "none" ? jhbDate(item.iso) : null }))
    .filter((row): row is { item: PaymentWhen; index: number; day: string } => !!row.day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.index - b.index);
  const datedIndex = new Set(dated.map((row) => row.index));
  const completion = items.filter((item) => item.tone === "completion").length;
  const none = items.filter((item, index) => item.tone !== "completion" && !datedIndex.has(index)).length;
  const extra: string[] = [];
  if (completion && dated.length) extra.push(completion === 1 ? "1 due on completion" : `${completion} due on completion`);
  if (none && dated.length) extra.push(none === 1 ? "1 with no date" : `${none} with no date`);
  const tail = extra.length ? ` · ${extra.join(" · ")}` : "";
  if (!dated.length) {
    if (completion && !none) return "Due on completion";
    if (!completion) return "Date not set";
    return none === 1 ? "Due on completion · 1 with no date" : `Due on completion · ${none} with no date`;
  }
  const first = dated[0];
  const last = dated[dated.length - 1];
  if (first.day === last.day) {
    const allExpected = dated.every((row) => row.item.tone === "expected");
    const allDue = dated.every((row) => row.item.tone === "due");
    const head = allExpected ? `Expected ${fmtDay(first.day)}` : allDue ? `Due ${fmtDay(first.day)}` : fmtDay(first.day);
    return `${head}${tail}`;
  }
  return `Next ${fmtDay(first.day)} – ${fmtDay(last.day)}${tail}`;
}

export function summariseAsOf(dates: (string | null | undefined)[], missing: number): string {
  const days = [...new Set(dates.map((d) => jhbDate(d)).filter((d): d is string => !!d))].sort();
  if (!days.length) return "Not entered";
  const head = days.length === 1 ? `As at ${fmtDay(days[0])}` : `As at ${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`;
  return missing > 0 ? `${head} · ${missing} not entered` : head;
}

export function summarisePayDates(dates: (string | null | undefined)[]): string {
  const known = dates.filter((d) => jhbDate(d));
  const missing = dates.length - known.length;
  if (!dates.length) return "Nothing still to buy";
  const rows: PaymentWhen[] = [
    ...known.map((iso) => ({ iso: iso ?? null, tone: "due" as const })),
    ...Array.from({ length: missing }, () => ({ iso: null, tone: "none" as const })),
  ];
  const summary = summarisePaymentDates(rows);
  if (summary === "Nothing due") return "Nothing still to buy";
  if (summary.startsWith("Due ")) return `Pay ${summary.slice(4)}`;
  if (summary.startsWith("Next ")) return `Next pay ${summary.slice(5)}`;
  if (summary === "Date not set") return "No pay date";
  return summary.replace("Due ", "Pay ").replace("Next ", "Next pay ");
}

export interface YardMoneyLine {
  id: string;
  label: string;
  amountLabel: string;
  dateLabel: string;
  href: string;
}

export interface YardMoneyTile {
  key: "cash" | "liabilities" | "deposits" | "finals";
  label: string;
  amountLabel: string | null;
  dateLine: string;
  href: string;
  rule: string;
  lines: YardMoneyLine[];
}

function invoiceTiles(companyId: string, invoices: HomeInvoice[], payments: Parameters<typeof countAdminHome>[0]["payments"], credits: Parameters<typeof countAdminHome>[0]["credits"], now: Date): { deposits: YardMoneyTile; finals: YardMoneyTile; invoice: { count: number; total: string } } {
  const counts = countAdminHome({ companyId, now, invoices, payments, credits });
  const byId = new Map(invoices.filter((inv) => inSignedInCompany(inv.company_id, companyId)).map((inv) => [inv.id, inv]));
  const tile = (key: "deposits" | "finals", label: string, href: string, kind: "deposit" | "final"): YardMoneyTile => {
    const figure = kind === "deposit" ? counts.deposit : counts.finalDue;
    const whens = figure.lines.map((line) => paymentWhen(byId.get(line.id) || { id: line.id }, kind));
    return {
      key,
      label,
      amountLabel: fmtHomeRand(figure.total),
      dateLine: summarisePaymentDates(whens),
      href,
      rule: figure.rule,
      lines: figure.lines.map((line, i) => ({
        id: line.id,
        label: line.label,
        amountLabel: formatRand(line.amount),
        dateLabel: paymentDateLabel(whens[i]),
        href: line.href,
      })),
    };
  };
  return {
    deposits: tile("deposits", "Expected deposits", YARD_LINKS.deposits, "deposit"),
    finals: tile("finals", "Expected finals", YARD_LINKS.finals, "final"),
    invoice: { count: counts.waiting.count, total: formatRand(counts.waiting.total).replace(/^R\s/, "R") },
  };
}

export function cashTile(accounts: BankAccount[] | null, balances: BankBalance[] | null, state: "ready" | "loading" | "error"): YardMoneyTile {
  if (state === "loading") {
    return {
      key: "cash", label: "Cash on hand", amountLabel: null, dateLine: "Loading…", href: YARD_LINKS.cash,
      rule: "Latest bank balance on Cash-flow health. Nothing is shown until a balance is entered.", lines: [],
    };
  }
  if (state === "error" || !accounts || !balances) {
    return {
      key: "cash", label: "Cash on hand", amountLabel: null, dateLine: "Couldn't load", href: YARD_LINKS.cash,
      rule: "Latest bank balance on Cash-flow health. Nothing is shown until a balance is entered.", lines: [],
    };
  }
  const started = startBalance(accounts, balances);
  const rows = latestBalances(accounts, balances).filter((row) => row.account.include);
  const entered = rows.filter((row) => row.balance !== null);
  const missing = rows.length - entered.length;
  return {
    key: "cash",
    label: "Cash on hand",
    amountLabel: started.entered ? fmtHomeRand(started.total) : null,
    dateLine: started.entered ? summariseAsOf(entered.map((row) => row.as_of), missing) : "Not entered",
    href: YARD_LINKS.cash,
    rule: "Latest balance entered for bank accounts included in Cash-flow health. Accounts with no balance are not given R0.",
    lines: entered.map((row) => ({
      id: row.account.id,
      label: row.account.label || "Bank account",
      amountLabel: fmtHomeRand(row.balance || 0),
      dateLabel: row.as_of ? `As at ${fmtDay(row.as_of)}` : "Not entered",
      href: YARD_LINKS.cash,
    })),
  };
}

export function liabilityTile(receipts: Receipt[] | null, commitments: Commitment[] | null, allocations: Allocation[] | null, state: "ready" | "loading" | "error"): YardMoneyTile {
  if (state === "loading") {
    return {
      key: "liabilities", label: "Liabilities", amountLabel: null, dateLine: "Loading…", href: YARD_LINKS.liabilities,
      rule: "Units and materials still to buy for deposited jobs that are not installed, at supplier cost incl. VAT.", lines: [],
    };
  }
  if (state === "error" || !receipts || !commitments || !allocations) {
    return {
      key: "liabilities", label: "Liabilities", amountLabel: null, dateLine: "Couldn't load", href: YARD_LINKS.liabilities,
      rule: "Units and materials still to buy for deposited jobs that are not installed, at supplier cost incl. VAT.", lines: [],
    };
  }
  const data = { receipts, commitments, allocations };
  const summary = jobLiabilities(data);
  const open = projects(data).filter((project) => project.deposit?.received && project.status !== "installed");
  const lines = open.flatMap((project) => project.lines.filter((line) => stillToPay(line, allocations) > 0).map((line) => ({ project, line, amount: stillToPay(line, allocations) })));
  const dates = lines.map((row) => row.line.pay_date);
  return {
    key: "liabilities",
    label: "Liabilities",
    amountLabel: fmtHomeRand(summary.total),
    dateLine: summarisePayDates(dates),
    href: YARD_LINKS.liabilities,
    rule: "Units and materials still to buy for jobs whose deposit is in but which are not installed, at supplier cost incl. VAT. The same total as Cash-flow health job liabilities. Pay dates are the dates stored on those lines.",
    lines: lines
      .sort((a, b) => String(a.line.pay_date || "9999").localeCompare(String(b.line.pay_date || "9999")) || a.line.item.localeCompare(b.line.item))
      .map((row) => ({
        id: row.line.id,
        label: [row.project.ref, row.line.item].filter(Boolean).join(" · "),
        amountLabel: fmtHomeRand(row.amount),
        dateLabel: row.line.pay_date ? `Pay ${fmtDay(row.line.pay_date)}` : "No pay date",
        href: row.line.job_id ? YARD_LINKS.job(row.line.job_id) : YARD_LINKS.liabilities,
      })),
  };
}

export interface YardSalesBox {
  key: "new" | "quoting" | "waiting" | "booked";
  label: string;
  count: number;
  href: string;
}

export type OpenLeadStage = "New lead" | "Quoting" | "Waiting on customer" | "Accepted";

export interface OpenLeadRow {
  id: string;
  customer: string;
  stage: OpenLeadStage;
  typeLabel: string | null;
  quoteRef: string | null;
  amountLabel: string | null;
  href: string;
}

const SERVICE = "service";

function usableLead(lead: YardLead, companyId: string): boolean {
  return inSignedInCompany(lead.company_id, companyId) && !lead.deleted_at && !lead.merged_into_id;
}

/** New lead, quoting, waiting on customer, booked. Open leads are those four except booked, plus accepted quotes that have no job yet. */
export function countSales(input: {
  companyId: string;
  now?: Date;
  leads?: YardLead[];
  quotes?: HomeQuote[];
  quoteJobs?: (PipeJob & { company_id?: string | null })[];
  /** primary_intent by lead id, including leads that are no longer pending. */
  leadIntent?: Record<string, string | null | undefined>;
  /** service_type by lead id, for leads that are no longer in the pending list. */
  leadService?: Record<string, string | null | undefined>;
}): { boxes: YardSalesBox[]; openLeads: number; openLeadRows: OpenLeadRow[] } {
  const companyId = input.companyId;
  const intent = { ...(input.leadIntent || {}) };
  const leads = (input.leads || []).filter((lead) => usableLead(lead, companyId));
  for (const lead of leads) if (lead.primary_intent) intent[lead.id] = lead.primary_intent;
  const quotes = (input.quotes || []).filter((quote) => inSignedInCompany(quote.company_id, companyId) && !quote.archived_at && String(quote.status || "").toLowerCase() !== "superseded");
  const salesQuotes = quotes.filter((quote) => !quote.lead_id || intent[quote.lead_id] !== SERVICE);
  const jobs = (input.quoteJobs || []).filter((job) => !job.company_id || inSignedInCompany(job.company_id, companyId));
  const deals = buildDeals(salesQuotes, [], jobs, input.now);
  const quotedLeadIds = new Set(quotes.map((quote) => quote.lead_id).filter((id): id is string => !!id));
  const fresh = leads.filter((lead) => String(lead.status || "").toLowerCase() === "pending" && lead.primary_intent !== SERVICE && !quotedLeadIds.has(lead.id));
  const n = (stage: string) => deals.filter((deal) => deal.stage === stage).length;
  const quoting = n("draft");
  const waiting = n("sent") + n("viewed");
  const booked = n("booked");
  const accepted = n("accepted");
  const serviceByLead: Record<string, string | null | undefined> = { ...(input.leadService || {}) };
  for (const lead of leads) if (lead.service_type) serviceByLead[lead.id] = lead.service_type;
  const typeOf = (raw?: string | null) => {
    const text = (raw || "").trim();
    return text ? jobTypeWord(text) : null;
  };
  const moneyOf = (quote: HomeQuote) => {
    if (quote.total == null || quote.total === "" || !Number.isFinite(Number(quote.total))) return null;
    return fmtHomeRand(Number(quote.total));
  };
  const stageLabel = (stage: string): OpenLeadStage | null => {
    if (stage === "draft") return "Quoting";
    if (stage === "sent" || stage === "viewed") return "Waiting on customer";
    if (stage === "accepted") return "Accepted";
    return null;
  };
  const freshRows: OpenLeadRow[] = [...fresh]
    .sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || "") || a.id.localeCompare(b.id))
    .map((lead) => ({
      id: `lead:${lead.id}`,
      customer: lead.customer_name || "Client",
      stage: "New lead",
      typeLabel: typeOf(lead.service_type),
      quoteRef: null,
      amountLabel: null,
      href: `/admin/dispatch?lead=${lead.id}`,
    }));
  const stageRank: Record<OpenLeadStage, number> = { "New lead": 0, Quoting: 1, "Waiting on customer": 2, Accepted: 3 };
  const dealRows: OpenLeadRow[] = deals
    .map((deal) => ({ deal, stage: stageLabel(deal.stage) }))
    .filter((row): row is { deal: typeof deals[number]; stage: OpenLeadStage } => !!row.stage)
    .sort((a, b) => stageRank[a.stage] - stageRank[b.stage] || (a.deal.quote.customer_name || "").localeCompare(b.deal.quote.customer_name || "") || a.deal.quote.id.localeCompare(b.deal.quote.id))
    .map(({ deal, stage }) => ({
      id: `quote:${deal.quote.id}`,
      customer: deal.quote.customer_name || "Client",
      stage,
      typeLabel: typeOf(deal.quote.lead_id ? serviceByLead[deal.quote.lead_id] : null),
      quoteRef: (deal.quote.quote_number || "").trim() || null,
      amountLabel: moneyOf(deal.quote),
      href: stage === "Accepted" ? YARD_LINKS.openLeads : `/admin/estimates/${deal.quote.id}`,
    }));
  const openLeadRows = [...freshRows, ...dealRows];
  return {
    openLeads: openLeadRows.length,
    openLeadRows,
    boxes: [
      { key: "new", label: "New lead", count: fresh.length, href: YARD_LINKS.newLead },
      { key: "quoting", label: "Quoting", count: quoting, href: YARD_LINKS.quoting },
      { key: "waiting", label: "Waiting on customer", count: waiting, href: YARD_LINKS.waitingCustomer },
      { key: "booked", label: "Booked", count: booked, href: YARD_LINKS.booked },
    ],
  };
}

export interface YardHomeModel {
  invoice: { count: number; total: string };
  cash: YardMoneyTile;
  liabilities: YardMoneyTile;
  deposits: YardMoneyTile;
  finals: YardMoneyTile;
  openLeads: { count: number; href: string };
  openLeadRows: OpenLeadRow[];
  jobs: { today: number; week: number; month: number; todayHref: string; weekHref: string; monthHref: string };
  stages: YardStageView[];
  sales: YardSalesBox[];
}

export function buildYardHome(input: {
  companyId: string;
  now?: Date;
  invoices?: HomeInvoice[];
  payments?: Parameters<typeof countAdminHome>[0]["payments"];
  credits?: Parameters<typeof countAdminHome>[0]["credits"];
  jobs?: YardJob[];
  presence?: YardPresence[];
  leads?: YardLead[];
  quotes?: HomeQuote[];
  quoteJobs?: (PipeJob & { company_id?: string | null })[];
  leadIntent?: Record<string, string | null | undefined>;
  leadService?: Record<string, string | null | undefined>;
  bank?: { accounts: BankAccount[]; balances: BankBalance[] } | null;
  bankState?: "ready" | "loading" | "error";
  books?: { receipts: Receipt[]; commitments: Commitment[]; allocations: Allocation[] } | null;
  booksState?: "ready" | "loading" | "error";
}): YardHomeModel {
  const now = input.now ?? new Date();
  const money = invoiceTiles(input.companyId, input.invoices || [], input.payments, input.credits, now);
  const periods = countJobPeriods(input.jobs || [], input.companyId, now);
  const sales = countSales(input);
  return {
    invoice: money.invoice,
    deposits: money.deposits,
    finals: money.finals,
    cash: cashTile(input.bank?.accounts ?? null, input.bank?.balances ?? null, input.bankState ?? (input.bank ? "ready" : "loading")),
    liabilities: liabilityTile(input.books?.receipts ?? null, input.books?.commitments ?? null, input.books?.allocations ?? null, input.booksState ?? (input.books ? "ready" : "loading")),
    openLeads: { count: sales.openLeads, href: YARD_LINKS.openLeads },
    openLeadRows: sales.openLeadRows,
    jobs: { ...periods, todayHref: YARD_LINKS.jobsToday, weekHref: YARD_LINKS.jobsWeek, monthHref: YARD_LINKS.jobsMonth },
    stages: groupYard(input.jobs || [], input.companyId, now, input.presence),
    sales: sales.boxes,
  };
}

/** Latest live assignment name. Rejected assignments are skipped. */
export function assigneeName(assignments: { status?: string | null; created_at?: string | null; profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null }[] | null | undefined): string | null {
  const live = (assignments || []).filter((row) => !REJECTED_ASSIGN.has(String(row.status || "").toLowerCase()));
  live.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const profile = live[0]?.profiles;
  const name = Array.isArray(profile) ? profile[0]?.full_name : profile?.full_name;
  return name || null;
}
