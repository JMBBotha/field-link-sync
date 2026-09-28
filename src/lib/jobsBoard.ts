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
