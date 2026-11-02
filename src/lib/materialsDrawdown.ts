import { quoteDrawQty, stockUnitFor, type CatalogueProduct, type StockUnit } from "./stockUnits";

export interface PlanQuoteItem { quote_item_id: string; product_id: string | null; item_name: string; quantity: number; product: CatalogueProduct | null }
export interface PlanStockItem { id: string; product_id: string | null; item: string; qty_on_hand: number; stock_unit: StockUnit; pack_size: number }
export interface PlanDrawn { stock_item_id: string; drawn_qty: number }
export interface PlanReserved { stock_item_id: string; qty: number }
export interface DrawRow {
  key: string; quote_item_id: string | null; stock_item_id: string | null; item: string; unit: StockUnit;
  quoted: number; already: number; suggested: number; on_hand: number; reserved: boolean; note: string | null;
}

/** Quote lines -> what to draw from stock (in stock units), minus what this job already drew. Units reserved via Projects lines are skipped (the trigger draws those). */
export function buildDrawPlan(items: PlanQuoteItem[], stock: PlanStockItem[], drawn: PlanDrawn[] = [], reserved: PlanReserved[] = []): DrawRow[] {
  const out: DrawRow[] = [];
  for (const q of items) {
    const map = q.product ? stockUnitFor(q.product) : null;
    if (map && map.kind !== "consumable") continue;
    const s = q.product_id ? stock.find((x) => x.product_id === q.product_id) : undefined;
    const quoted = q.product ? quoteDrawQty(q.quantity, q.product, map!, q.item_name) : q.quantity;
    const already = s ? drawn.filter((d) => d.stock_item_id === s.id).reduce((a, d) => a + Number(d.drawn_qty || 0), 0) : 0;
    const isReserved = !!s && reserved.some((r) => r.stock_item_id === s.id);
    const suggested = isReserved ? 0 : Math.max(0, round(quoted - already));
    let note: string | null = null;
    if (!s) note = "Not a stock item: nothing drawn";
    else if (!isReserved && s.stock_unit === "kg" && quoted === 0) note = "Enter the kg actually used";
    else if (isReserved) note = "Reserved on a Projects line: drawn when the job is installed";
    else if (suggested > s.qty_on_hand) note = `Only ${s.qty_on_hand} ${s.stock_unit} on hand`;
    else if (already > 0) note = `${already} ${s.stock_unit} already drawn`;
    out.push({ key: q.quote_item_id, quote_item_id: q.quote_item_id, stock_item_id: s?.id ?? null, item: s?.item ?? q.item_name,
      unit: s?.stock_unit ?? map?.stock_unit ?? "each", quoted, already, suggested, on_hand: s?.qty_on_hand ?? 0, reserved: isReserved, note });
  }
  return out;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Payload for job_materials_draw: only rows with a stock item and a positive qty. */
export const toDrawPayload = (rows: DrawRow[], qty: Record<string, number>) =>
  rows.filter((r) => r.stock_item_id && !r.reserved).map((r) => ({ stock_item_id: r.stock_item_id!, quote_item_id: r.quote_item_id, qty: round(qty[r.key] ?? r.suggested) }))
    .filter((r) => r.qty > 0);
