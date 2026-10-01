/**
 * Quote pipeline (Jobs hub · Pipeline tab). Pure helpers, no I/O.
 * Stages come from real data: quotes.status + invoices (deposit / paid) + jobs (booked / cancelled).
 */
export type PipelineStage = "lead" | "draft" | "sent" | "viewed" | "accepted" | "booked" | "lost";
export type DealFlag = "paid_no_job" | "job_cancelled" | "expired" | "stale" | "no_view" | "zero";

export const STAGES: { key: PipelineStage; label: string; hint: string }[] = [
  { key: "lead", label: "New lead", hint: "no value until quoted" },
  { key: "draft", label: "Draft", hint: "not sent yet" },
  { key: "sent", label: "Sent", hint: "not opened yet" },
  { key: "viewed", label: "Viewed · follow up", hint: "client opened it" },
  { key: "accepted", label: "Accepted · deposit", hint: "book the job" },
  { key: "booked", label: "Job booked", hint: "handed over to Dispatch" },
  { key: "lost", label: "Lost", hint: "declined" },
];

export const FLAG_META: Record<DealFlag, { label: string; tone: "red" | "orange" | "yellow" }> = {
  paid_no_job: { label: "PAID · NO JOB", tone: "red" },
  job_cancelled: { label: "JOB CANCELLED", tone: "red" },
  expired: { label: "EXPIRED", tone: "red" },
  stale: { label: "STALE", tone: "orange" },
  no_view: { label: "NO VIEW", tone: "orange" },
  zero: { label: "R0", tone: "yellow" },
};

export type PipeQuote = {
  id: string; status: string | null; total: number | string | null; created_at: string;
  sent_at?: string | null; viewed_at?: string | null; accepted_at?: string | null; declined_at?: string | null;
  updated_at?: string | null; valid_until?: string | null; lead_id?: string | null; sales_engineer_id?: string | null;
};
export type PipeInvoice = { quote_id: string | null; status: string | null; notes?: string | null; grand_total?: number | string | null };
export type PipeJob = { quote_id: string | null; status: string | null; created_at?: string | null };

export type Deal<Q extends PipeQuote = PipeQuote> = {
  quote: Q; stage: PipelineStage; value: number; days: number; flags: DealFlag[];
  paid: number; partPaid: boolean; depositDue: boolean;
};

const DAY = 86_400_000;
const OPEN: PipelineStage[] = ["draft", "sent", "viewed"];
const LOST = new Set(["declined", "rejected", "lost", "cancelled"]);
const VOID = new Set(["void", "cancelled"]);
export const STALE_DAYS = 7;

export const daysSince = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : 0;
export const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const fmtRand = (n: number) => `R${Math.round(n).toLocaleString("en-ZA")}`;
export const fmtRandShort = (n: number) =>
  n >= 1_000_000 ? `R${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `R${(n / 1000).toFixed(1)}k` : `R${Math.round(n)}`;

/** Stage of one quote. Superseded quotes are not deals (null). */
export function stageOf(q: PipeQuote, jobs: PipeJob[]): PipelineStage | null {
  const s = String(q.status || "draft").toLowerCase();
  if (s === "superseded") return null;
  if (LOST.has(s)) return "lost";
  if (jobs.some((j) => j.status !== "cancelled")) return "booked";
  if (s === "accepted") return "accepted";
  if (s === "viewed") return "viewed";
  if (s === "sent") return "sent";
  if (s === "expired") return q.sent_at ? "sent" : "draft";
  return "draft";
}

function stageSince(stage: PipelineStage, q: PipeQuote, jobs: PipeJob[]): string | null | undefined {
  switch (stage) {
    case "sent": return q.sent_at ?? q.updated_at;
    case "viewed": return q.viewed_at ?? q.sent_at ?? q.updated_at;
    case "accepted": return q.accepted_at ?? q.updated_at;
    case "booked": return jobs.find((j) => j.status !== "cancelled")?.created_at ?? q.accepted_at;
    case "lost": return q.declined_at ?? q.updated_at;
    default: return q.created_at;
  }
}

export function isExpired(q: PipeQuote, now: Date) {
  return !!q.valid_until && new Date(`${String(q.valid_until).slice(0, 10)}T23:59:59`).getTime() < now.getTime();
}

/** Build one deal per (non-superseded) quote. */
export function buildDeals<Q extends PipeQuote>(quotes: Q[], invoices: PipeInvoice[], jobs: PipeJob[], now = new Date()): Deal<Q>[] {
  const invBy = new Map<string, PipeInvoice[]>();
  invoices.forEach((i) => { if (i.quote_id) invBy.set(i.quote_id, [...(invBy.get(i.quote_id) || []), i]); });
  const jobBy = new Map<string, PipeJob[]>();
  jobs.forEach((j) => { if (j.quote_id) jobBy.set(j.quote_id, [...(jobBy.get(j.quote_id) || []), j]); });
  const out: Deal<Q>[] = [];
  for (const q of quotes) {
    const qj = jobBy.get(q.id) || [];
    const stage = stageOf(q, qj);
    if (!stage) continue;
    const inv = (invBy.get(q.id) || []).filter((i) => !VOID.has(String(i.status || "")));
    const paid = inv.filter((i) => i.status === "paid").reduce((s, i) => s + num(i.grand_total), 0);
    const partPaid = inv.some((i) => i.status === "partially_paid");
    const depositDue = stage === "accepted" && inv.some((i) => String(i.notes || "").startsWith("DEPOSIT") && !["paid", "partially_paid"].includes(String(i.status)));
    const value = num(q.total);
    const days = daysSince(stageSince(stage, q, qj), now);
    const flags: DealFlag[] = [];
    if (stage === "accepted" && qj.some((j) => j.status === "cancelled")) flags.push("job_cancelled");
    else if (stage === "accepted" && (paid > 0 || partPaid)) flags.push("paid_no_job");
    const expired = OPEN.includes(stage) && isExpired(q, now);
    if (expired) flags.push("expired");
    if (OPEN.includes(stage) && !expired && days > STALE_DAYS) flags.push("stale");
    if (stage === "sent" && !q.viewed_at && daysSince(q.sent_at, now) > 3) flags.push("no_view");
    if (value <= 0 && stage !== "lost") flags.push("zero");
    out.push({ quote: q, stage, value, days, flags, paid, partPaid, depositDue });
  }
  return out;
}

export function columnSummary(deals: Deal[], stage: PipelineStage) {
  const d = deals.filter((x) => x.stage === stage);
  return {
    count: d.length,
    total: d.reduce((s, x) => s + x.value, 0),
    avgDays: d.length ? Math.round(d.reduce((s, x) => s + x.days, 0) / d.length) : 0,
  };
}

/** Open deals (draft → accepted, not booked) worth chasing first: value × days stale. */
export function followUps<Q extends PipeQuote>(deals: Deal<Q>[]): Deal<Q>[] {
  const score = (d: Deal) => Math.max(d.value, 1) * (d.days + 1) * (d.flags.includes("paid_no_job") || d.flags.includes("job_cancelled") ? 10 : 1);
  return deals.filter((d) => [...OPEN, "accepted"].includes(d.stage)).sort((a, b) => score(b) - score(a));
}

export type PipelineChipKey = DealFlag | "stale_reply" | "not_contacted";
/** Needs-attention chips for the Pipeline tab (counts + rand where useful). */
export function pipelineChips(deals: Deal[], leadsNotContacted: number) {
  const sum = (f: (d: Deal) => boolean) => { const d = deals.filter(f); return { n: d.length, value: d.reduce((s, x) => s + x.value, 0) }; };
  return [
    { key: "paid_no_job" as PipelineChipKey, tone: "red", label: "deposits paid · no job booked", ...sum((d) => d.flags.includes("paid_no_job")) },
    { key: "job_cancelled" as PipelineChipKey, tone: "red", label: "deposit paid · job cancelled", ...sum((d) => d.flags.includes("job_cancelled")) },
    { key: "expired" as PipelineChipKey, tone: "orange", label: "quotes expired while open", ...sum((d) => d.flags.includes("expired")) },
    { key: "stale_reply" as PipelineChipKey, tone: "orange", label: `sent/viewed >${STALE_DAYS} days, no reply`, ...sum((d) => (d.stage === "sent" || d.stage === "viewed") && d.days > STALE_DAYS) },
    { key: "zero" as PipelineChipKey, tone: "yellow", label: "quotes at R0", ...sum((d) => d.flags.includes("zero")) },
    { key: "not_contacted" as PipelineChipKey, tone: "yellow", label: "leads never contacted", n: leadsNotContacted, value: 0 },
  ].filter((c) => c.n > 0);
}

export function matchesChip(d: Deal, key: PipelineChipKey | null) {
  if (!key || key === "not_contacted") return true;
  if (key === "stale_reply") return (d.stage === "sent" || d.stage === "viewed") && d.days > STALE_DAYS;
  return d.flags.includes(key);
}

export type DropAction = "send" | "accept" | "book" | "lose";
/** What a drag from one stage to another should open. Never a raw status write. */
export function dropAction(from: PipelineStage, to: PipelineStage): { action: DropAction | null; reason?: string } {
  if (from === to) return { action: null };
  if (to === "lost") return from === "booked" || from === "lead" ? { action: null, reason: "Can't mark this as lost here." } : { action: "lose" };
  if (to === "booked") return from === "accepted" ? { action: "book" } : { action: null, reason: "Accept the quote first, then book the job." };
  if (to === "accepted") return OPEN.includes(from) ? { action: "accept" } : { action: null, reason: "Can't move a deal back." };
  if (to === "sent" && from === "draft") return { action: "send" };
  return { action: null, reason: "Can't move a deal back." };
}
