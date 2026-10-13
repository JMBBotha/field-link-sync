// Lead → Paid flow (Johan 13 Oct 2026). Pure, derived from EXISTING data only (no new columns).
// 9 stages on one line; urgency colours per flow.md §10: red = overdue, yellow = due soon,
// blue = on time / your next step, grey = done or waiting on someone else. Orange is brand only.
import { DEFAULT_SLA, nextOpen, type SlaSettings } from "@/lib/leadClock";

/** Human span: 45m · 3h 05m · 4d (anything from 48h up shown in days). */
export const span = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); if (m < 60) return `${m}m`; if (m < 48 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; return `${Math.floor(m / 1440)}d`; };
const hm = span;

export const STAGES = ["NEW", "BOOKED", "VISIT", "QUOTE", "ACCEPTED", "DEPOSIT", "SCHEDULED", "DONE", "PAID"] as const;
export type Stage = (typeof STAGES)[number];
export type Urgency = "red" | "yellow" | "blue" | "grey";
export type Parked = "no_answer" | "waiting_stock" | "lost";
export const SALES_STAGES: Stage[] = ["BOOKED", "VISIT", "QUOTE", "ACCEPTED"];
const RANK: Record<Urgency, number> = { red: 3, yellow: 2, blue: 1, grey: 0 };

export type FlowLead = { id: string; customer_name?: string | null; status?: string | null; lead_status?: string | null; source?: string | null;
  primary_intent?: string | null; service_type?: string | null; created_at?: string | null; first_contact_at?: string | null;
  contact_attempts?: number | null; scheduled_date?: string | null; scheduled_time?: string | null; deleted_at?: string | null };
export type FlowQuote = { id: string; lead_id?: string | null; customer_name?: string | null; status?: string | null; created_at?: string | null;
  sent_at?: string | null; accepted_at?: string | null; declined_at?: string | null; superseded_by?: string | null; quote_number?: string | null };
export type FlowInvoice = { id: string; quote_id?: string | null; lead_id?: string | null; status?: string | null; grand_total?: number | null;
  deposit_amount?: number | null; sent_at?: string | null; created_at?: string | null; due_date?: string | null; invoice_number?: string | null };
export type FlowJob = { id: string; lead_id?: string | null; quote_id?: string | null; invoice_id?: string | null; title?: string | null; status?: string | null;
  scheduled_for?: string | null; started_at?: string | null; completed_at?: string | null; awaiting_stock?: boolean | null; job_type?: string | null };
export type FlowPayment = { invoice_id?: string | null; amount?: number | null; status?: string | null; created_at?: string | null };
export type FlowData = { leads: FlowLead[]; quotes: FlowQuote[]; invoices: FlowInvoice[]; jobs: FlowJob[]; payments: FlowPayment[] };

export type FlowItem = { key: string; client: string; stage: Stage; urgency: Urgency; label: string; action: string; href: string;
  dueAt: number | null; parked?: Parked; done?: boolean };

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const t = (s?: string | null) => (s ? Date.parse(s) : NaN);
const endOfLocalDay = (ms: number) => { const tz = 2 * HOUR; return Math.floor((ms + tz) / DAY) * DAY + DAY - tz; };
export const isPhoneLead = (src?: string | null) => /call|phone|vapi|voice/i.test(src || "");
export const isServiceLead = (l: FlowLead) =>
  l.primary_intent === "service" || (l.primary_intent !== "sales" && !/sales|consult|quote|install/i.test(l.service_type || ""));

/** Urgency for a deadline: red past due, yellow past the amber point, otherwise blue (or grey when waiting on others). */
export function urgencyFor(now: number, due: number, amberAt: number, waiting = false): { urgency: Urgency; label: string } {
  if (now >= due) return { urgency: "red", label: `OVERDUE ${hm(now - due)}` };
  if (now >= amberAt) return { urgency: "yellow", label: `DUE IN ${hm(due - now)}` };
  return waiting ? { urgency: "grey", label: "WAITING on client" } : { urgency: "blue", label: `ON TIME ${hm(due - now)} left` };
}

/** Target for a NEW lead: website/form = SLA contact minutes (5, amber at 3); phone = confirm within 30 (amber at 20). */
export function newLeadTarget(l: FlowLead, s: SlaSettings = DEFAULT_SLA) {
  if (isPhoneLead(l.source)) return { minutes: 30, amber: 20, action: "Confirm booking" };
  const m = s.contactMinutes || 5;
  return { minutes: m, amber: Math.round(m * 0.6 * 10) / 10, action: "Call client" };
}

const CLOSED_LEAD = ["cancelled", "resolved_before_visit", "lost"];

export function deriveFlow(d: FlowData, now: number, s: SlaSettings = DEFAULT_SLA): FlowItem[] {
  const out: FlowItem[] = [];
  const paidBy = new Map<string, number>();
  for (const p of d.payments) if (p.invoice_id && (p.status || "paid") === "paid") paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) || 0) + Number(p.amount || 0));
  const paidOf = (i: FlowInvoice) => (i.status === "paid" ? Number(i.grand_total || 0) : paidBy.get(i.id) || 0);
  const liveQuotes = d.quotes.filter((q) => !q.superseded_by);
  const quoteByLead = new Map<string, FlowQuote>();
  for (const q of liveQuotes) if (q.lead_id) { const c = quoteByLead.get(q.lead_id); if (!c || t(q.created_at) > t(c.created_at)) quoteByLead.set(q.lead_id, q); }
  const usedQuotes = new Set<string>(), usedJobs = new Set<string>();

  const quoteChain = (key: string, client: string, q: FlowQuote, leadJob?: FlowJob) => {
    usedQuotes.add(q.id);
    const href = `/admin/estimates/${q.id}`;
    if (q.declined_at) return out.push({ key, client, stage: "QUOTE", urgency: "grey", label: "LOST · declined", action: "View", href, dueAt: null, parked: "lost" });
    if (q.status === "draft") {
      const due = t(q.created_at) + DAY;
      return out.push({ key, client, stage: "QUOTE", ...urgencyFor(now, due, due - 8 * HOUR), action: "Send quote", href, dueAt: due });
    }
    if (q.status !== "accepted" && !q.accepted_at) {
      const sent = t(q.sent_at) || t(q.created_at), due = sent + 7 * DAY;
      return out.push({ key, client, stage: "QUOTE", ...urgencyFor(now, due, sent + 3 * DAY, true), action: "Follow up", href, dueAt: due });
    }
    // Accepted → deposit is ALWAYS required (Johan 13 Oct).
    const invs = d.invoices.filter((i) => i.quote_id === q.id);
    const accepted = t(q.accepted_at) || t(q.sent_at) || t(q.created_at);
    if (!invs.length) {
      const due = accepted + DAY;
      return out.push({ key, client, stage: "ACCEPTED", ...urgencyFor(now, due, accepted + 4 * HOUR), action: "Send deposit invoice", href, dueAt: due });
    }
    const inv = invs.sort((a, b) => t(a.created_at) - t(b.created_at))[0];
    const total = invs.reduce((a, i) => a + Number(i.grand_total || 0), 0);
    const paid = invs.reduce((a, i) => a + paidOf(i), 0);
    const depositNeeded = Number(inv.deposit_amount || 0) > 0 ? Number(inv.deposit_amount) : 0.01;
    const invHref = `/admin/invoices/${inv.id}`;
    if (paid < depositNeeded) {
      if (inv.status === "draft" && !inv.sent_at) {
        const due = accepted + DAY;
        return out.push({ key, client, stage: "DEPOSIT", ...urgencyFor(now, due, accepted + 4 * HOUR), action: "Send deposit invoice", href: invHref, dueAt: due });
      }
      const sent = t(inv.sent_at) || t(inv.created_at), due = sent + 7 * DAY;
      return out.push({ key, client, stage: "DEPOSIT", ...urgencyFor(now, due, sent + 3 * DAY, true), action: "Chase deposit", href: invHref, dueAt: due });
    }
    const job = leadJob ?? d.jobs.find((j) => j.quote_id === q.id || invs.some((i) => i.id === j.invoice_id));
    if (job) usedJobs.add(job.id);
    const payTimes = d.payments.filter((p) => invs.some((i) => i.id === p.invoice_id)).map((p) => t(p.created_at)).filter((x) => !isNaN(x));
    const depositAt = payTimes.length ? Math.min(...payTimes) : accepted;
    return jobChain(key, client, job, invs, total, paid, depositAt, invHref);
  };

  const jobChain = (key: string, client: string, job: FlowJob | undefined, invs: FlowInvoice[], total: number, paid: number, depositAt: number, invHref: string) => {
    if (!job || job.status === "cancelled" || (!job.scheduled_for && !job.completed_at)) {
      if (job?.awaiting_stock) return out.push({ key, client, stage: "SCHEDULED", urgency: "grey", label: "WAITING on supplier", action: "Check supplier", href: `/admin/jobs/${job.id}`, dueAt: null, parked: "waiting_stock" });
      const due = depositAt + 2 * DAY;
      return out.push({ key, client, stage: "SCHEDULED", ...urgencyFor(now, due, depositAt + DAY), action: "Schedule job", href: job ? `/admin/jobs/${job.id}` : invHref, dueAt: due });
    }
    const jobHref = `/admin/jobs/${job.id}`;
    if (job.status !== "completed" && !job.completed_at) {
      if (job.awaiting_stock) return out.push({ key, client, stage: "SCHEDULED", urgency: "grey", label: "WAITING on supplier", action: "Check supplier", href: jobHref, dueAt: null, parked: "waiting_stock" });
      const at = t(job.scheduled_for), due = endOfLocalDay(at);
      return out.push({ key, client, stage: "SCHEDULED", ...urgencyFor(now, due, at - 2 * HOUR), action: "Start job", href: jobHref, dueAt: due });
    }
    if (total > 0 && paid + 0.005 >= total) return out.push({ key, client, stage: "PAID", urgency: "grey", label: "PAID", action: "View", href: invHref || jobHref, dueAt: null, done: true });
    const done = t(job.completed_at) || now;
    const final = invs.find((i) => i.due_date);
    if (!invs.length || invs.every((i) => i.status === "draft" && !i.sent_at)) {
      const due = done + DAY;
      return out.push({ key, client, stage: "DONE", ...urgencyFor(now, due, done + 4 * HOUR), action: "Send final invoice", href: invHref || jobHref, dueAt: due });
    }
    const due = final?.due_date ? endOfLocalDay(t(final.due_date)) : done + 7 * DAY;
    return out.push({ key, client, stage: "DONE", ...urgencyFor(now, due, due - 2 * DAY, true), action: "Chase payment", href: invHref || jobHref, dueAt: due });
  };

  for (const l of d.leads) {
    if (l.deleted_at) continue;
    const client = l.customer_name || "Client";
    const key = `lead:${l.id}`, href = `/admin/dispatch?lead=${l.id}`;
    const q = quoteByLead.get(l.id);
    const leadJob = d.jobs.find((j) => j.lead_id === l.id);
    if (q) { if (leadJob) usedJobs.add(leadJob.id); quoteChain(key, client, q, leadJob); continue; }
    if (CLOSED_LEAD.includes(l.status || "") || CLOSED_LEAD.includes(l.lead_status || "")) {
      if (l.status === "cancelled" || l.lead_status === "lost") out.push({ key, client, stage: "NEW", urgency: "grey", label: "LOST", action: "View", href, dueAt: null, parked: "lost" });
      continue;
    }
    if (leadJob) {
      usedJobs.add(leadJob.id);
      const invs = d.invoices.filter((i) => i.lead_id === l.id || i.id === leadJob.invoice_id);
      const total = invs.reduce((a, i) => a + Number(i.grand_total || 0), 0), paid = invs.reduce((a, i) => a + paidOf(i), 0);
      jobChain(key, client, leadJob, invs, total, paid, t(l.created_at), invs[0] ? `/admin/invoices/${invs[0].id}` : "");
      continue;
    }
    if (l.status === "completed" || l.status === "converted") continue;
    if (!l.first_contact_at) {
      if ((l.contact_attempts || 0) >= 3) { out.push({ key, client, stage: "NEW", urgency: "grey", label: "NO ANSWER · 3 tries", action: "Send 'we tried' email", href, dueAt: null, parked: "no_answer" }); continue; }
      const tg = newLeadTarget(l, s), start = nextOpen(t(l.created_at), s);
      if (now < start) { out.push({ key, client, stage: "NEW", urgency: "grey", label: `Starts ${s.open}`, action: tg.action, href, dueAt: start + tg.minutes * MIN }); continue; }
      out.push({ key, client, stage: "NEW", ...urgencyFor(now, start + tg.minutes * MIN, start + tg.amber * MIN), action: tg.action, href, dueAt: start + tg.minutes * MIN });
      continue;
    }
    if (!l.scheduled_date) {
      const c = nextOpen(t(l.first_contact_at), s), due = c + 2 * HOUR;
      out.push({ key, client, stage: "BOOKED", ...urgencyFor(now, due, c + HOUR), action: "Agree time", href, dueAt: due });
      continue;
    }
    const at = Date.parse(`${l.scheduled_date}T${(l.scheduled_time || "08:00").slice(0, 5)}:00+02:00`), due = endOfLocalDay(at);
    if (now < at - DAY) { out.push({ key, client, stage: "BOOKED", urgency: "blue", label: `BOOKED ${l.scheduled_date}`, action: "View visit", href, dueAt: at }); continue; }
    out.push({ key, client, stage: "VISIT", ...urgencyFor(now, due, at), action: isServiceLead(l) ? "Complete visit" : "Complete visit · quote", href, dueAt: due });
  }
  for (const q of liveQuotes) if (!usedQuotes.has(q.id) && !q.lead_id) quoteChain(`quote:${q.id}`, q.customer_name || q.quote_number || "Quote", q);
  for (const j of d.jobs) if (!usedJobs.has(j.id) && !j.lead_id && !j.quote_id && j.status !== "cancelled") {
    const invs = d.invoices.filter((i) => i.id === j.invoice_id);
    const total = invs.reduce((a, i) => a + Number(i.grand_total || 0), 0), paid = invs.reduce((a, i) => a + paidOf(i), 0);
    jobChain(`job:${j.id}`, j.title || "Job", j, invs, total, paid, t(j.scheduled_for) || now, invs[0] ? `/admin/invoices/${invs[0].id}` : "");
  }
  return out;
}

export type StageSummary = { stage: Stage; count: number; urgency: Urgency; red: number; yellow: number };
export function summarise(items: FlowItem[]): { stages: StageSummary[]; parked: Record<Parked, number> } {
  const parked: Record<Parked, number> = { no_answer: 0, waiting_stock: 0, lost: 0 };
  const stages = STAGES.map((stage) => ({ stage, count: 0, urgency: "grey" as Urgency, red: 0, yellow: 0 }));
  for (const i of items) {
    if (i.parked) { parked[i.parked]++; continue; }
    const st = stages[STAGES.indexOf(i.stage)];
    st.count++; if (i.urgency === "red") st.red++; if (i.urgency === "yellow") st.yellow++;
    if (!i.done && RANK[i.urgency] > RANK[st.urgency]) st.urgency = i.urgency;
  }
  return { stages, parked };
}

/** Next up: red (most overdue first) → yellow (closest deadline) → blue (closest) ; grey/done/parked excluded. */
export function nextUp(items: FlowItem[], max = 7): FlowItem[] {
  return items.filter((i) => !i.parked && !i.done && i.urgency !== "grey")
    .sort((a, b) => RANK[b.urgency] - RANK[a.urgency] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    .slice(0, max);
}
