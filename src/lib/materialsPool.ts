/** Materials pool on hand. Phase 1 movements are the ledger.
 *  Only the materials bucket counts. Units and direct deliveries do not. */

export interface PoolMovement {
  bucket: string;
  qty: number;
  unitCost: number | null;
  /** Extra rand booked with no quantity (an invoice price difference). */
  valueAdjust?: number | null;
  counts?: boolean;
}

export interface PoolLine {
  label: string;
  qty: number;
  value: number;
}

export function poolValue(movements: PoolMovement[]): number {
  return round2(movements.filter(counts).reduce((sum, row) => sum + lineValue(row), 0));
}

export function poolLines(rows: { label: string; qty: number; unitCost: number | null; valueAdjust?: number | null; counts?: boolean; bucket?: string }[]): PoolLine[] {
  const map = new Map<string, PoolLine>();
  for (const row of rows) {
    if (row.bucket && row.bucket !== "material_pool") continue;
    if (row.counts === false) continue;
    const cur = map.get(row.label) || { label: row.label, qty: 0, value: 0 };
    cur.qty = round3(cur.qty + (Number(row.qty) || 0));
    cur.value = round2(cur.value + lineValue({ bucket: "material_pool", qty: Number(row.qty) || 0, unitCost: row.unitCost, valueAdjust: row.valueAdjust, counts: true }));
    map.set(row.label, cur);
  }
  return [...map.values()].filter((line) => line.qty !== 0 || line.value !== 0).sort((a, b) => a.label.localeCompare(b.label));
}

function counts(row: PoolMovement): boolean {
  return row.bucket === "material_pool" && row.counts !== false;
}

function lineValue(row: PoolMovement): number {
  const qty = Number(row.qty) || 0;
  const cost = row.unitCost == null ? 0 : Number(row.unitCost) || 0;
  return qty * cost + (Number(row.valueAdjust) || 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface MaterialBuy {
  item: string;
  qty: string;
  unit: string;
  total: string;
  date: string;
  supplier: string;
  docRef: string;
  used: string;
}

export function materialBuyError(buy: MaterialBuy): string | null {
  if (!buy.item.trim()) return "Name the item or the category.";
  const qty = Number(buy.qty);
  if (!(qty > 0)) return "Quantity must be more than zero.";
  if (!buy.unit.trim()) return "Say the unit, such as m or each.";
  const total = Number(buy.total);
  if (!(total >= 0)) return "Total cost is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buy.date)) return "Date is required.";
  const used = buy.used.trim() === "" ? 0 : Number(buy.used);
  if (!Number.isFinite(used) || used < 0) return "Already used must be zero or more.";
  if (used > qty) return "Already used is more than the quantity bought.";
  return null;
}
