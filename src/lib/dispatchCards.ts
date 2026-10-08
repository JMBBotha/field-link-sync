/**
 * Jobs hub phase 3: Dispatch · Cards helpers (pure).
 * Urgency order: late → unassigned (soonest first) → urgent/high → starts < 2 h → en route → on site → later → done.
 * jobs.status has no en_route/on_site: dispatched = "En route", in_progress = "On site".
 */
import { isCancelled, rowDate } from "@/lib/jobsBoard";

export type DJob = {
  id: string; title?: string | null; status?: string | null; priority?: string | null; scheduled_for?: string | null;
  started_at?: string | null; job_type?: string | null;
  assignments?: { profile_id: string; status?: string | null; profiles?: { full_name?: string | null; phone?: string | null } | null }[] | null;
};
export type UrgencyKey = "late" | "unassigned" | "urgent" | "soon" | "en_route" | "on_site" | "later" | "done";
export type Urgency = { key: UrgencyKey; rank: number; mins: number | null };

const norm = (s?: string | null) => String(s || "").toLowerCase().trim();
const RANK: Record<UrgencyKey, number> = { late: 0, unassigned: 1, urgent: 2, soon: 3, en_route: 4, on_site: 5, later: 6, done: 7 };

export const activeAssignee = (j: DJob) => (j.assignments || []).find((a) => norm(a.status) !== "rejected") || null;

/** Minutes until the scheduled start (negative = past). Date-only values count as no time. */
export function minsToStart(j: DJob, now: Date): number | null {
  const sf = j.scheduled_for;
  if (!sf || /^\d{4}-\d{2}-\d{2}$/.test(sf)) return null;
  const t = new Date(sf).getTime();
  return isNaN(t) ? null : Math.round((t - now.getTime()) / 60000);
}

export function jobUrgency(j: DJob, now: Date): Urgency {
  const s = norm(j.status);
  const mins = minsToStart(j, now);
  const key: UrgencyKey =
    s === "completed" ? "done"
    : s === "in_progress" ? "on_site"
    : mins !== null && mins < 0 ? "late"
    : !activeAssignee(j) ? "unassigned"
    : ["urgent", "high"].includes(norm(j.priority)) ? "urgent"
    : mins !== null && mins <= 120 ? "soon"
    : s === "dispatched" ? "en_route"
    : "later";
  return { key, rank: RANK[key], mins };
}

/** Jobs on a Johannesburg calendar day, cancelled dropped, most urgent first (ties: earliest start, then title). */
export function sortDispatchJobs<T extends DJob>(jobs: T[], day: string, now: Date): (T & { urgency: Urgency })[] {
  return jobs
    .filter((j) => !isCancelled(j.status) && rowDate({ kind: "job", id: j.id, status: j.status ?? "", job: j }) === day)
    .map((j) => ({ ...j, urgency: jobUrgency(j, now) }))
    .sort((a, b) => a.urgency.rank - b.urgency.rank
      || (a.scheduled_for || "~").localeCompare(b.scheduled_for || "~")
      || String(a.title || "").localeCompare(String(b.title || "")));
}

export const STATUS_PILL: Record<string, { label: string; className: string; bar: string }> = {
  unassigned: { label: "UNASSIGNED", className: "bg-red-600 text-white", bar: "border-l-red-600" },
  scheduled: { label: "SCHEDULED", className: "bg-blue-600 text-white", bar: "border-l-blue-600" },
  dispatched: { label: "EN ROUTE", className: "bg-orange-500 text-white", bar: "border-l-orange-500" },
  in_progress: { label: "ON SITE", className: "bg-emerald-600 text-white", bar: "border-l-emerald-600" },
  completed: { label: "DONE", className: "bg-slate-400 text-white", bar: "border-l-slate-400" },
  proposed: { label: "Proposed", className: "bg-amber-500 text-white", bar: "border-l-amber-500" },
};
export function pillFor(j: DJob) {
  const s = norm(j.status);
  if (s !== "completed" && s !== "in_progress" && !activeAssignee(j)) return STATUS_PILL.unassigned;
  return STATUS_PILL[s] || STATUS_PILL.scheduled;
}

export const NEXT_STATUS: Record<string, { to: string; label: string }> = {
  scheduled: { to: "dispatched", label: "Mark en route" },
  dispatched: { to: "in_progress", label: "On site" },
  in_progress: { to: "completed", label: "Done" },
};

export const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);

export type TechRow = { id: string; name: string; phone: string | null; jobs: number; late: number; state: "on_site" | "en_route" | "next" | "done"; next: string | null };

/** One row per assigned tech for the day's jobs (cancelled already dropped). */
export function techStrip(jobs: (DJob & { urgency?: Urgency })[], now: Date): TechRow[] {
  const by: Record<string, TechRow> = {};
  for (const j of jobs) {
    const a = activeAssignee(j);
    if (!a) continue;
    const r = (by[a.profile_id] ||= { id: a.profile_id, name: a.profiles?.full_name || "Tech", phone: a.profiles?.phone || null, jobs: 0, late: 0, state: "done", next: null });
    r.jobs++;
    const u = j.urgency || jobUrgency(j, now);
    if (u.key === "late") r.late++;
    const s = norm(j.status);
    if (s === "in_progress") r.state = "on_site";
    else if (s === "dispatched" && r.state !== "on_site") r.state = "en_route";
    else if (s !== "completed" && r.state === "done") r.state = "next";
    if (s !== "completed" && s !== "in_progress" && j.scheduled_for && (!r.next || j.scheduled_for < r.next)) r.next = j.scheduled_for;
  }
  return Object.values(by).sort((a, b) => a.name.localeCompare(b.name));
}
