/** Pure clash maths (overlap / tight / after-hours). No money, no queries. */
import { TRAVEL_BUFFER_MIN, WORK_DAYS, WORK_END, WORK_START, hhmm, toMinutes } from "@/lib/schedulingDefaults";

export type Slot = { start: string; end: string };
export type Booking = Slot & { id?: string; label?: string | null; job_id?: string | null; lead_id?: string | null };
export type ClashRow = { kind: "overlap" | "tight"; start_time: string; end_time: string; label: string; job_id?: string | null; lead_id?: string | null };

/** Times overlap; touching edges (10:00–11:00 vs 11:00–12:00) do not. */
export function overlaps(a: Slot, b: Slot): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** Gap between non-overlapping slots under the travel buffer. */
export function isTight(a: Slot, b: Slot, buffer = TRAVEL_BUFFER_MIN): boolean {
  if (overlaps(a, b)) return false;
  const gap = toMinutes(a.start) >= toMinutes(b.end)
    ? toMinutes(a.start) - toMinutes(b.end)
    : toMinutes(b.start) - toMinutes(a.end);
  return gap >= 0 && gap < buffer;
}

export function isAfterHours(date: string, slot: Slot): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!WORK_DAYS.includes(dow)) return true;
  return toMinutes(slot.start) < toMinutes(WORK_START) || toMinutes(slot.end) > toMinutes(WORK_END);
}

/** Classify bookings against a slot, excluding the booking itself. */
export function findClashes(
  slot: Slot,
  bookings: Booking[],
  exclude: { id?: string | null; job_id?: string | null; lead_id?: string | null } = {},
): ClashRow[] {
  const out: ClashRow[] = [];
  for (const b of bookings) {
    if (exclude.id && b.id === exclude.id) continue;
    if (exclude.job_id && b.job_id === exclude.job_id) continue;
    if (exclude.lead_id && b.lead_id === exclude.lead_id && !b.job_id) continue;
    const kind = overlaps(slot, b) ? "overlap" : isTight(slot, b) ? "tight" : null;
    if (kind) out.push({ kind, start_time: b.start, end_time: b.end, label: b.label || "Busy", job_id: b.job_id, lead_id: b.lead_id });
  }
  return out;
}

export function clashSummary(rows: ClashRow[]): string {
  return rows.map((r) => `${r.kind} ${hhmm(r.start_time)}–${hhmm(r.end_time)} ${r.label}`).join("; ").slice(0, 300);
}

/** For calendar badges: for each tile id, the first other tile of the same person/day that overlaps. */
export function overlapMap<T extends { id: string; agent_id: string | null; scheduled_date: string; start_time: string; end_time: string; label?: string | null }>(tiles: T[]): Map<string, T> {
  const out = new Map<string, T>();
  const groups = new Map<string, T[]>();
  for (const t of tiles) {
    if (!t.agent_id || !t.start_time || !t.end_time) continue;
    const k = `${t.agent_id}|${t.scheduled_date}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(t);
  }
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (overlaps({ start: a.start_time, end: a.end_time }, { start: b.start_time, end: b.end_time })) {
        if (!out.has(a.id)) out.set(a.id, b);
        if (!out.has(b.id)) out.set(b.id, a);
      }
    }
  }
  return out;
}
