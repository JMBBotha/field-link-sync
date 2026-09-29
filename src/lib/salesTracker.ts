/**
 * Sales rep "My commission" tracker (Job 5) — pure helpers over get_sales_tracker().
 * The RPC already scopes rows: a rep gets only their own quotes, the owner gets every rep, anyone else nothing.
 * Earned / paid-out rows come from the frozen snapshot (rep, %, profit, commission at first full payment).
 */
export type TrackerGroup = "pipeline" | "earned" | "paid_out";
export interface TrackerRow {
  grp: TrackerGroup;
  frozen: boolean;
  snapshot_id: string | null;
  quote_id: string;
  quote_number: string | null;
  rep_id: string;
  rep_name: string | null;
  percent: number | null;
  items_sell_ex_vat: number | null;
  items_cost: number | null;
  items_profit: number | null;
  commission: number | null;
  unknown_cost_count: number;
  accepted_at: string | null;
  earned_at: string | null;
  invoice_paid_date: string | null;
  paid_at: string | null;
}
export interface SalesTracker { api_version: number; user_id: string; is_owner: boolean; rows: TrackerRow[] }
export interface GroupTotals { count: number; items_sell: number; items_cost: number; items_profit: number; commission: number }

export const GROUP_ORDER: { key: TrackerGroup; label: string; hint: string }[] = [
  { key: "pipeline", label: "Pipeline", hint: "Accepted, not yet fully paid" },
  { key: "earned", label: "Earned", hint: "Fully paid, not yet paid out" },
  { key: "paid_out", label: "Paid out", hint: "Commission paid to you" },
];

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function totalsOf(rows: TrackerRow[]): GroupTotals {
  return {
    count: rows.length,
    items_sell: r2(rows.reduce((a, r) => a + num(r.items_sell_ex_vat), 0)),
    items_cost: r2(rows.reduce((a, r) => a + num(r.items_cost), 0)),
    items_profit: r2(rows.reduce((a, r) => a + num(r.items_profit), 0)),
    commission: r2(rows.reduce((a, r) => a + num(r.commission), 0)),
  };
}

/** Rows split into pipeline / earned / paid out (optionally for one rep), each with totals. */
export function groupTracker(rows: TrackerRow[], repId?: string | null) {
  const scoped = repId ? rows.filter((r) => r.rep_id === repId) : rows;
  return GROUP_ORDER.map((g) => {
    const list = scoped.filter((r) => r.grp === g.key);
    return { ...g, rows: list, totals: totalsOf(list) };
  });
}

/** Distinct reps in the rows (owner filter), by name. */
export function repsOf(rows: TrackerRow[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (r.rep_id && !m.has(r.rep_id)) m.set(r.rep_id, (r.rep_name || "Unknown").trim());
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface SalespersonLogRow { old_status: string | null; new_status: string | null; changed_by: string | null; created_at: string }
export interface SalespersonChange { from: string | null; to: string | null; by: string | null; at: string }

/**
 * 'Change salesperson' entries from status_change_log, oldest first. The app and the DB trigger can both log the
 * same change, so identical from→to entries within 2 minutes collapse into one.
 */
export function salespersonHistory(rows: SalespersonLogRow[]): SalespersonChange[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: SalespersonChange[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.from === r.old_status && prev.to === r.new_status
        && Math.abs(Date.parse(r.created_at) - Date.parse(prev.at)) <= 120_000) {
      if (!prev.by && r.changed_by) prev.by = r.changed_by;
      continue;
    }
    out.push({ from: r.old_status, to: r.new_status, by: r.changed_by, at: r.created_at });
  }
  return out;
}

export function formatSastDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00+02:00` : iso);
  return d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric" });
}

/** "Pieter → Lisa (29 Sep 2026, by Johan)" entries joined with " · ". */
export function salespersonHistoryText(changes: SalespersonChange[], names: Record<string, string>): string {
  const n = (id: string | null) => (id ? (names[id] || "Unknown").trim() : "None");
  return changes
    .map((c) => `${n(c.from)} → ${n(c.to)} (${formatSastDate(c.at)}${c.by ? `, by ${n(c.by)}` : ""})`)
    .join(" · ");
}
