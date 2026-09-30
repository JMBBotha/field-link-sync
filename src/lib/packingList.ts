/** Tech job sheet packing list. Rows come from get_job_packing_list: name, code, quantity and area only (never prices). */
export type PackingRow = {
  area_name: string | null; area_sort: number | null; kit_name: string | null;
  item_code: string | null; item_name: string | null; quantity: number | string | null; line_sort: number | null;
};
export type PackingLine = PackingRow & { key: string };

/** Keep the server order, group by area; each line gets a stable key for its tick. */
export function groupPackingList(rows: PackingRow[]): { area: string; rows: PackingLine[] }[] {
  const out: { area: string; rows: PackingLine[] }[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const area = r.area_name || "General";
    let g = out.find((x) => x.area === area);
    if (!g) { g = { area, rows: [] }; out.push(g); }
    const base = [area, r.kit_name || "", r.item_code || "", r.item_name || ""].join("|");
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    g.rows.push({ ...r, key: n > 1 ? `${base}#${n}` : base });
  }
  return out;
}

const tickKey = (jobId: string) => `fls.packing.${jobId}`;
export function loadTicks(jobId: string): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(tickKey(jobId)) || "{}") || {}; } catch { return {}; }
}
export function saveTicks(jobId: string, ticks: Record<string, boolean>) {
  try { localStorage.setItem(tickKey(jobId), JSON.stringify(ticks)); } catch { /* storage blocked: ticks stay in memory */ }
}
export const fmtQty = (q: unknown) => { const n = Number(q); return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "-"; };
