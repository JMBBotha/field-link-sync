/**
 * Sales heartbeat (Johan 20 Oct 10:47). Pure helpers, no I/O.
 * 8 stages: lead in > contacted > quote visit > quote sent > accepted > deposit in > install booked > done (unpaid) > paid.
 * Beats = real timestamped sales actions; rhythm weakens with stalled items; flatline when nothing happens while items wait.
 */
export type HbStageKey = "new" | "contacted" | "visit" | "sent" | "accepted" | "deposit" | "install" | "done";
export type HbLimits = {
  leadRepMin: number; leadTeamMin: number; leadOwnerMin: number; contactedDays: number; contactedAdminDays: number;
  sentDays: number; viewedDays: number; viewedAdminDays: number; acceptedDays: number; acceptedAdminDays: number; depositDays: number; doneDays: number;
  remoteFollowupDays: number; visitFollowup1Days: number; visitFollowup2Days: number;
  invPreDays: number; invCallDays: number; invUrgentDays: number; invOwnerDays: number;
};
export const DEFAULT_LIMITS: HbLimits = {
  leadRepMin: 5, leadTeamMin: 15, leadOwnerMin: 30, contactedDays: 1, contactedAdminDays: 2, sentDays: 2, viewedDays: 3,
  viewedAdminDays: 7, acceptedDays: 2, acceptedAdminDays: 4, depositDays: 1, doneDays: 7,
  remoteFollowupDays: 2, visitFollowup1Days: 3, visitFollowup2Days: 7,
  invPreDays: 3, invCallDays: 3, invUrgentDays: 7, invOwnerDays: 14,
};
export const LIMIT_LABELS: { key: keyof HbLimits; label: string; unit: "min" | "days" }[] = [
  { key: "leadRepMin", label: "New lead → nudge rep", unit: "min" },
  { key: "leadTeamMin", label: "New lead → all sales + admin", unit: "min" },
  { key: "leadOwnerMin", label: "New lead → owner", unit: "min" },
  { key: "contactedDays", label: "Contacted, no visit → rep", unit: "days" },
  { key: "contactedAdminDays", label: "Contacted, no visit → admin", unit: "days" },
  { key: "sentDays", label: "Quote sent, not viewed → rep", unit: "days" },
  { key: "viewedDays", label: "Quote viewed, no answer → rep", unit: "days" },
  { key: "viewedAdminDays", label: "Quote viewed, no answer → admin", unit: "days" },
  { key: "acceptedDays", label: "Accepted, no deposit → rep", unit: "days" },
  { key: "acceptedAdminDays", label: "Accepted, no deposit → admin", unit: "days" },
  { key: "depositDays", label: "Deposit in, no install → dispatch + admin", unit: "days" },
  { key: "doneDays", label: "Job done, not paid → admin", unit: "days" },
  { key: "remoteFollowupDays", label: "Online quote sent → follow-up call", unit: "days" },
  { key: "visitFollowup1Days", label: "Site-visit quote → 1st friendly follow-up", unit: "days" },
  { key: "visitFollowup2Days", label: "1st → 2nd friendly follow-up", unit: "days" },
  { key: "invPreDays", label: "Invoice: friendly heads-up, days before due", unit: "days" },
  { key: "invCallDays", label: "Invoice: reminder + call task, days late", unit: "days" },
  { key: "invUrgentDays", label: "Invoice: urgent reminder + banner, days late", unit: "days" },
  { key: "invOwnerDays", label: "Invoice: owner phones client, days late", unit: "days" },
];
export const toLimits = (raw: unknown): HbLimits => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LIMITS };
  (Object.keys(out) as (keyof HbLimits)[]).forEach((k) => { const n = Number(o[k]); if (Number.isFinite(n) && n > 0) out[k] = n; });
  return out;
};

export type HbLead = {
  id: string; customer_name?: string | null; created_at: string; first_contact_at?: string | null; acknowledged_at?: string | null;
  visit_booked_at?: string | null; last_contact_attempt_at?: string | null; primary_intent?: string | null; assigned_agent_id?: string | null;
  status?: string | null; call_summary?: string | null; customer_phone?: string | null; phone?: string | null;
};
export type HbQuote = {
  id: string; status: string | null; total: number | string | null; created_at: string; sent_at?: string | null; viewed_at?: string | null;
  accepted_at?: string | null; lead_id?: string | null; sales_engineer_id?: string | null; customer_name?: string | null; quote_number?: string | null;
};
export type HbInvoice = { quote_id: string | null; status: string | null; notes?: string | null; grand_total?: number | string | null; paid_date?: string | null };
export type HbJob = { id?: string; quote_id: string | null; status: string | null; created_at?: string | null; scheduled_for?: string | null; completed_at?: string | null; title?: string | null };

export type HbItem = {
  id: string; kind: "lead" | "quote" | "job"; stage: HbStageKey; title: string; sub: string; value: number;
  since: string; age: string; overBy: number; limit: number; stalled: boolean; escalated: boolean; next: { label: string; to: string }; owner?: string | null;
};
export type HbStage = { key: HbStageKey; label: string; count: number; value: number; stalled: number; close: number; tone: "grey" | "amber" | "red" };
export type HbBeat = { t: number; h: number; label: string };
export type Heartbeat = {
  stages: HbStage[]; items: HbItem[]; next: HbItem | null; then: HbItem[]; stalled: HbItem[];
  beats: HbBeat[]; strength: number; flatline: boolean; lastBeatAt: number | null; pulse: { pct: number | null; answered: number; total: number };
  hot: HbLead[]; openValue: number;
};

export const STAGE_META: { key: HbStageKey; label: string }[] = [
  { key: "new", label: "New lead" }, { key: "contacted", label: "Contacted" }, { key: "visit", label: "Quote visit" },
  { key: "sent", label: "Quote sent" }, { key: "accepted", label: "Accepted" }, { key: "deposit", label: "Deposit in" },
  { key: "install", label: "Install booked" }, { key: "done", label: "Done · unpaid" },
];
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN);
export const fmtAge = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / MIN));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
};
const LOST = new Set(["declined", "rejected", "lost", "cancelled", "superseded", "void", "expired"]);
const isDeposit = (i: HbInvoice) => String(i.notes || "").startsWith("DEPOSIT");
const isPaid = (i: HbInvoice) => ["paid", "partially_paid"].includes(String(i.status));
const isSalesLead = (l: HbLead) => l.primary_intent !== "service";

/** Business-hours check (SAST, Mon–Fri 08:00–17:00) for the flatline rule. */
export const inBusinessHours = (ms: number) => {
  const d = new Date(ms + 2 * HOUR); const dow = d.getUTCDay(); const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return dow >= 1 && dow <= 5 && h >= 8 && h < 17;
};

export function buildHeartbeat(input: {
  leads: HbLead[]; quotes: HbQuote[]; invoices: HbInvoice[]; jobs: HbJob[]; limits?: HbLimits; contactMinutes?: number;
  escalatedIds?: Set<string>; now?: number; windowHours?: number;
}): Heartbeat {
  const now = input.now ?? Date.now(); const L = input.limits ?? DEFAULT_LIMITS; const win = (input.windowHours ?? 24) * HOUR;
  const esc = input.escalatedIds ?? new Set<string>();
  const leads = input.leads.filter(isSalesLead);
  const quotes = input.quotes.filter((q) => !LOST.has(String(q.status)));
  const invByQuote = new Map<string, HbInvoice[]>(); input.invoices.forEach((i) => { if (i.quote_id) invByQuote.set(i.quote_id, [...(invByQuote.get(i.quote_id) || []), i]); });
  const jobByQuote = new Map<string, HbJob>(); input.jobs.forEach((j) => { if (j.quote_id && j.status !== "cancelled") jobByQuote.set(j.quote_id, j); });
  const quotedLeads = new Set(input.quotes.map((q) => q.lead_id).filter(Boolean) as string[]);
  const items: HbItem[] = [];
  const push = (it: Omit<HbItem, "age" | "stalled" | "escalated" | "limit"> & { limitMs: number }) => {
    const ms = now - t(it.since); const overBy = ms - it.limitMs;
    const { limitMs, ...rest } = it;
    items.push({ ...rest, overBy, limit: limitMs, age: fmtAge(ms), stalled: overBy >= 0, escalated: esc.has(it.id) });
  };
  const leadName = (l: HbLead) => l.customer_name || "New lead";

  leads.filter((l) => l.status === "pending" && !quotedLeads.has(l.id)).forEach((l) => {
    const to = `/admin/dispatch?lead=${l.id}`;
    if (!l.first_contact_at) push({ id: l.id, kind: "lead", stage: "new", title: `Call ${leadName(l)}`, sub: l.call_summary ? String(l.call_summary).slice(0, 90) : "New lead · not contacted", value: 0, since: l.created_at, overBy: 0, next: { label: "Call now", to }, owner: l.assigned_agent_id, limitMs: L.leadRepMin * MIN });
    else if (!l.visit_booked_at) push({ id: l.id, kind: "lead", stage: "contacted", title: `Book visit · ${leadName(l)}`, sub: "Contacted · no visit booked", value: 0, since: l.first_contact_at, overBy: 0, next: { label: "Book visit", to }, owner: l.assigned_agent_id, limitMs: L.contactedDays * DAY });
    else push({ id: l.id, kind: "lead", stage: "visit", title: `Send quote · ${leadName(l)}`, sub: "Visit booked · quote not sent", value: 0, since: l.visit_booked_at, overBy: 0, next: { label: "Build quote", to }, owner: l.assigned_agent_id, limitMs: Math.max(L.sentDays, 1) * DAY });
  });

  quotes.forEach((q) => {
    const inv = invByQuote.get(q.id) || []; const job = jobByQuote.get(q.id); const value = num(q.total);
    const n = q.customer_name || q.quote_number || "Quote"; const to = `/admin/estimates/${q.id}`; const num_ = q.quote_number || "Quote";
    const fullyPaid = inv.some((i) => !isDeposit(i) && String(i.status) === "paid");
    const depositPaid = inv.some((i) => isPaid(i));
    if (job?.status === "completed") {
      if (!fullyPaid) push({ id: job.id || q.id, kind: "job", stage: "done", title: `Get paid · ${n}`, sub: `${num_} · job finished, not paid in full`, value, since: job.completed_at || job.created_at || q.created_at, overBy: 0, next: { label: "Send reminder", to: job.id ? `/admin/jobs/${job.id}` : to }, owner: q.sales_engineer_id, limitMs: L.doneDays * DAY });
      return;
    }
    if (job) { push({ id: job.id || q.id, kind: "job", stage: "install", title: `Install · ${n}`, sub: job.scheduled_for ? `Booked ${new Date(job.scheduled_for).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : "Install booked", value, since: job.created_at || q.created_at, overBy: 0, next: { label: "Open job", to: job.id ? `/admin/jobs/${job.id}` : to }, owner: q.sales_engineer_id, limitMs: Math.max(0, t(job.scheduled_for) - t(job.created_at || q.created_at)) + DAY }); return; }
    const status = String(q.status);
    if (status === "accepted" || q.accepted_at) {
      if (depositPaid) push({ id: q.id, kind: "quote", stage: "deposit", title: `Book install · ${n}`, sub: `${num_} · deposit in, no install date`, value, since: q.accepted_at || q.created_at, overBy: 0, next: { label: "Book install", to }, owner: q.sales_engineer_id, limitMs: L.depositDays * DAY });
      else push({ id: q.id, kind: "quote", stage: "accepted", title: `Take deposit · ${n}`, sub: `${num_} accepted · no deposit yet`, value, since: q.accepted_at || q.created_at, overBy: 0, next: { label: "Take deposit", to }, owner: q.sales_engineer_id, limitMs: L.acceptedDays * DAY });
      return;
    }
    if (status === "draft") { push({ id: q.id, kind: "quote", stage: "sent", title: `Send quote · ${n}`, sub: `${num_} · draft, not sent`, value, since: q.created_at, overBy: 0, next: { label: "Send quote", to }, owner: q.sales_engineer_id, limitMs: DAY }); return; }
    if (q.viewed_at) push({ id: q.id, kind: "quote", stage: "sent", title: `Follow up · ${n}`, sub: `${num_} viewed · no answer`, value, since: q.viewed_at, overBy: 0, next: { label: "Follow up", to }, owner: q.sales_engineer_id, limitMs: L.viewedDays * DAY });
    else push({ id: q.id, kind: "quote", stage: "sent", title: `Check quote landed · ${n}`, sub: `${num_} sent · not opened`, value, since: q.sent_at || q.created_at, overBy: 0, next: { label: "Follow up", to }, owner: q.sales_engineer_id, limitMs: L.sentDays * DAY });
  });

  const stages: HbStage[] = STAGE_META.map((s) => {
    const its = items.filter((i) => i.stage === s.key);
    const stalled = its.filter((i) => i.stalled).length;
    const close = its.filter((i) => !i.stalled && i.overBy > -0.25 * i.limit).length; // in the last quarter of its limit
    return { key: s.key, label: s.label, count: its.length, value: its.reduce((a, b) => a + b.value, 0), stalled, close, tone: stalled ? "red" : close ? "amber" : "grey" };
  });

  // Order: hot leads (clock running) first, then most overdue, then highest value.
  const rank = (i: HbItem) => (i.stage === "new" ? 0 : i.stalled ? 1 : 2);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b) || b.overBy - a.overBy || b.value - a.value);
  const actionable = ordered.filter((i) => i.stage !== "install");

  // Beats: real events in the window. Height = stage weight (+ value bonus), 0..1.
  const W: Record<string, number> = { ack: 0.25, contact: 0.35, attempt: 0.2, visit: 0.45, sent: 0.55, viewed: 0.3, accepted: 0.85, deposit: 0.8, install: 0.6, done: 0.65, paid: 1 };
  const beats: HbBeat[] = [];
  const add = (iso: string | null | undefined, kind: string, label: string, value = 0) => {
    const ms = t(iso); if (!Number.isFinite(ms) || ms < now - win || ms > now) return;
    const bonus = value > 0 ? Math.min(0.25, Math.log10(1 + value / 1000) / 8) : 0;
    beats.push({ t: ms, h: Math.min(1, W[kind] + bonus), label });
  };
  leads.forEach((l) => { add(l.acknowledged_at, "ack", "Lead picked up"); add(l.first_contact_at, "contact", "First contact"); add(l.last_contact_attempt_at, "attempt", "Call logged"); add(l.visit_booked_at, "visit", "Visit booked"); });
  input.quotes.forEach((q) => { const v = num(q.total); add(q.sent_at, "sent", "Quote sent", v); add(q.viewed_at, "viewed", "Quote viewed", v); add(q.accepted_at, "accepted", "Quote accepted", v); });
  input.invoices.forEach((i) => { if (isPaid(i)) add(i.paid_date, isDeposit(i) ? "deposit" : "paid", isDeposit(i) ? "Deposit received" : "Paid", num(i.grand_total)); });
  input.jobs.forEach((j) => { if (j.quote_id) { add(j.created_at, "install", "Install booked"); add(j.completed_at, "done", "Job finished"); } });
  beats.sort((a, b) => a.t - b.t);
  const lastBeatAt = beats.length ? beats[beats.length - 1].t : null;
  const stalledCount = items.filter((i) => i.stalled).length;
  const strength = Math.max(0.25, 1 - 0.08 * stalledCount);
  const waiting = actionable.length > 0;
  // Flatline: items are waiting and no action for 2 business hours (or none in the window at all).
  const quietMs = lastBeatAt == null ? Infinity : now - lastBeatAt;
  const flatline = waiting && (lastBeatAt == null || (quietMs >= 2 * HOUR && inBusinessHours(now)));

  // Pulse: sales leads in the last 7 days answered (first contact or "I'm on it") within the contact limit.
  const cm = (input.contactMinutes ?? L.leadRepMin) * MIN;
  const recent = leads.filter((l) => t(l.created_at) >= now - 7 * DAY && t(l.created_at) <= now - cm);
  const answered = recent.filter((l) => { const r = Math.min(t(l.first_contact_at) || Infinity, t(l.acknowledged_at) || Infinity); return r - t(l.created_at) <= cm; }).length;

  const hot = leads.filter((l) => l.status === "pending" && !l.first_contact_at && !l.acknowledged_at && !quotedLeads.has(l.id) && t(l.created_at) > now - 3 * DAY)
    .sort((a, b) => t(a.created_at) - t(b.created_at));

  return {
    stages, items: ordered, next: actionable[0] || null, then: actionable.slice(1, 5), stalled: ordered.filter((i) => i.stalled && i.stage !== "new").slice(0, 6),
    beats, strength, flatline, lastBeatAt, pulse: { pct: recent.length ? Math.round((answered / recent.length) * 100) : null, answered, total: recent.length },
    hot, openValue: items.filter((i) => ["sent", "accepted", "deposit"].includes(i.stage)).reduce((a, b) => a + b.value, 0),
  };
}

/** ECG polyline points (0..width, 0..height) from beats across the window; amplitude scaled by strength; flat when flatline. */
export function ecgPoints(beats: HbBeat[], opts: { now: number; windowHours?: number; width: number; height: number; strength: number; flatline: boolean }) {
  const { now, width, height, strength } = opts; const win = (opts.windowHours ?? 24) * HOUR; const mid = height * 0.6;
  const pts: string[] = [`0,${mid}`];
  if (!opts.flatline) beats.forEach((b) => {
    const x = ((b.t - (now - win)) / win) * width; const a = b.h * strength * (height * 0.55);
    pts.push(`${(x - 6).toFixed(1)},${mid}`, `${(x - 3).toFixed(1)},${(mid - a).toFixed(1)}`, `${x.toFixed(1)},${(mid + a * 0.45).toFixed(1)}`, `${(x + 3).toFixed(1)},${mid}`);
  });
  pts.push(`${width},${mid}`);
  return pts.join(" ");
}
