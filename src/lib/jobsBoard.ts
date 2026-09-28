/**
 * Pure helpers for the Jobs & Dispatch board. Never drops a row:
 * unknown statuses land in Scheduled; cancelled is hidden unless toggled.
 */
import type { CalendarEntry } from "@/lib/todaysJobs";

export const BOARD_COLUMNS = ["scheduled", "dispatched", "in_progress", "completed"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export type BoardRow =
  | { kind: "job"; id: string; status: string; job: any }
  | { kind: "lead"; id: string; status: string; entry: CalendarEntry };

const norm = (s?: string | null) => String(s || "").toLowerCase().trim();
export const isCancelled = (s?: string | null) => ["cancelled", "canceled"].includes(norm(s));

export function columnFor(status?: string | null): BoardColumn {
  const s = norm(status) as BoardColumn;
  return (BOARD_COLUMNS as readonly string[]).includes(s) ? s : "scheduled";
}

/** Jobs + booked calendar entries (de-duped against jobs by job_id). */
export function buildBoardRows(jobs: any[], entries: CalendarEntry[]): BoardRow[] {
  const jobIds = new Set(jobs.map((j) => j.id));
  const rows: BoardRow[] = jobs.map((j) => ({ kind: "job", id: j.id, status: j.status ?? "", job: j }));
  for (const e of entries) {
    if (e.job_id && jobIds.has(e.job_id)) continue;
    if (e.job_id) {
      rows.push({ kind: "job", id: e.job_id, status: e.status ?? "", job: { id: e.job_id, status: e.status, title: e.customer_name || "Job", address: e.customer_address, scheduled_for: e.date ? `${e.date}T${e.start_time || "00:00"}` : null, assignments: [] } });
      jobIds.add(e.job_id);
      continue;
    }
    if (!e.lead_id) continue;
    rows.push({ kind: "lead", id: e.lead_id, status: e.status ?? "", entry: e });
  }
  return rows;
}

export function groupBoardRows(rows: BoardRow[], showCancelled: boolean) {
  const map: Record<BoardColumn, BoardRow[]> = { scheduled: [], dispatched: [], in_progress: [], completed: [] };
  let cancelled = 0;
  for (const r of rows) {
    if (isCancelled(r.status)) {
      cancelled++;
      if (!showCancelled) continue;
    }
    map[columnFor(r.status)].push(r);
  }
  const open = BOARD_COLUMNS.reduce((n, c) => n + map[c].length, 0);
  return { columns: map, cancelled, visible: open };
}

export function rowTarget(r: Pick<BoardRow, "kind" | "id">): string {
  return r.kind === "job" ? `/admin/jobs/${r.id}` : `/admin/dispatch?lead=${r.id}`;
}

// ───────── Step 2: lane, assignee, URL filters ─────────
import { laneOf, type LeadLane } from "@/lib/leadLane";
import { todayInJohannesburg } from "@/lib/todaysJobs";

const SALES_JOB_TYPES = ["quote", "sales", "consultation"];

/** Sales vs Service for any board row. */
export function boardLane(row: BoardRow): LeadLane {
  if (row.kind === "job") return SALES_JOB_TYPES.includes(norm(row.job?.job_type)) ? "sales" : "service";
  return laneOf(row.entry) ?? "service"; // same lane rule as the /admin/dispatch inbox
}

export type Person = { full_name?: string | null; participant_type?: string | null };
export type BoardAssignee = { id: string; name: string; contractor: boolean } | null;

/** Active assignee: job → first non-rejected assignment; lead → agent_id. */
export function rowAssignee(row: BoardRow, people: Record<string, Person> = {}): BoardAssignee {
  let id: string | null = null;
  let p: Person | undefined;
  if (row.kind === "job") {
    const a = (row.job?.assignments || []).find((x: any) => x.status !== "rejected");
    if (a) { id = a.profile_id; p = a.profiles || people[a.profile_id]; }
  } else if (row.entry.agent_id) {
    id = row.entry.agent_id; p = people[id];
  }
  if (!id) return null;
  const pt = p?.participant_type;
  return { id, name: p?.full_name || "Assigned", contractor: !!pt && pt !== "company_staff" };
}

/** Johannesburg calendar date of the row. */
export function rowDate(row: BoardRow): string | null {
  if (row.kind === "lead") return row.entry.date || null;
  const sf = row.job?.scheduled_for;
  if (!sf) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(sf)) return sf;
  const d = new Date(sf);
  return isNaN(d.getTime()) ? null : todayInJohannesburg(d);
}

export type BoardFilters = {
  status?: string | null; date?: string | null; assignee?: string | null; lane?: string | null; type?: string | null;
};
export const FILTER_KEYS = ["status", "date", "assignee", "lane", "type"] as const;

export function filterBoardRows(rows: BoardRow[], f: BoardFilters, people: Record<string, Person> = {}, now = new Date()): BoardRow[] {
  const date = f.date === "today" ? todayInJohannesburg(now) : f.date;
  return rows.filter((r) => {
    if (f.status) {
      if (f.status === "cancelled") { if (!isCancelled(r.status)) return false; }
      else if (isCancelled(r.status) || columnFor(r.status) !== f.status) return false;
    }
    if (date && rowDate(r) !== date) return false;
    if (f.assignee) {
      const a = rowAssignee(r, people);
      if (f.assignee === "none" ? !!a : a?.id !== f.assignee) return false;
    }
    if (f.lane && boardLane(r) !== f.lane) return false;
    if (f.type && (r.kind !== "job" || norm(r.job?.job_type) !== norm(f.type))) return false;
    return true;
  });
}
