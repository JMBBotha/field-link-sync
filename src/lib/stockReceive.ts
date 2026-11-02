import { stockUnitFor, toStockQty, costPerStockUnit, type CatalogueProduct, type UnitMapping } from "./stockUnits";

export type DocType = "delivery_note" | "supplier_invoice" | string;
export type ReceiveAction = "stock" | "reserve" | "installed" | "skip";

export interface ExtractedLine { line_no: number; description: string; model_number: string | null; qty: number; unit_price_excl: number | null }
export interface Product extends CatalogueProduct { id: string; cost_price?: number | null; product_type?: string | null }

/** FCMI-24-P / FCMI-24X-P / "fcmi 24" -> FCMI24.  Strips spaces, dashes and the -P/-X/-L supplier suffixes. */
export function normaliseModel(code: string | null | undefined) {
  let c = (code ?? "").toUpperCase().replace(/[\s_/.]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  c = c.replace(/-(P|L)$/i, "").replace(/X$/i, "").replace(/-(P|L)$/i, "");
  return c.replace(/-/g, "");
}

export interface Match { product: Product | null; how: "exact" | "normalised" | "none"; lookalikes: Product[] }

/** Match a supplier line to the catalogue. Never guesses across families: FCMI vs FCMF is reported as a look-alike, not a match. */
export function matchProduct(model: string | null, products: Product[]): Match {
  if (!model) return { product: null, how: "none", lookalikes: [] };
  const raw = model.trim().toUpperCase();
  const exact = products.find((p) => (p.product_code ?? "").trim().toUpperCase() === raw);
  const n = normaliseModel(model);
  const norm = exact ? null : products.find((p) => normaliseModel(p.product_code) === n) ?? null;
  const hit = exact ?? norm;
  const fam = n.replace(/\d.*$/, "");
  const digits = n.slice(fam.length);
  const lookalikes = products.filter((p) => {
    if (p === hit) return false;
    const pn = normaliseModel(p.product_code);
    const pf = pn.replace(/\d.*$/, "");
    return pf !== fam && pn.slice(pf.length) === digits && pf.length === fam.length && editDistance(pf, fam) === 1;
  });
  return { product: hit, how: exact ? "exact" : norm ? "normalised" : "none", lookalikes };
}
function editDistance(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

export type PriceFlag = { level: "warn" | "note" | "none"; text: string };
/** Invoice price vs what we expected (earlier delivery note / catalogue cost). Higher = warn, lower = note. */
export function priceCheck(invoiceUnit: number | null, expectedUnit: number | null, tolerance = 0.005): PriceFlag {
  if (invoiceUnit == null || expectedUnit == null || expectedUnit <= 0) return { level: "none", text: "" };
  const diff = (invoiceUnit - expectedUnit) / expectedUnit;
  const pct = `${Math.abs(diff * 100).toFixed(1)}%`;
  if (diff > tolerance) return { level: "warn", text: `Invoice R${invoiceUnit.toFixed(2)} is ${pct} higher than expected R${expectedUnit.toFixed(2)}` };
  if (diff < -tolerance) return { level: "note", text: `Invoice R${invoiceUnit.toFixed(2)} is ${pct} lower than expected R${expectedUnit.toFixed(2)}` };
  return { level: "none", text: "" };
}

export interface EarlierLine { product_id: string | null; normalised: string; unit_cost_excl: number | null; receive_action: string | null; receive_job_id: string | null }
export interface PreviewRow {
  line: ExtractedLine; match: Match; map: UnitMapping | null; action: ReceiveAction; job_id: string | null;
  unit_cost_pack: number | null; cost_source: "invoice" | "catalogue" | "none";
  stock_qty: number; cost_per_stock_unit: number | null; adds_stock: boolean; price: PriceFlag; notes: string[];
}

/**
 * Build the preview for one document.
 * - Invoice lines add stock at invoice price. Delivery notes record the catalogue cost but never add stock.
 * - An invoice line inherits reserve/installed + job from the earlier delivery note line for the same product (same PO).
 */
export function buildPreview(docType: DocType, lines: ExtractedLine[], products: Product[], earlier: EarlierLine[] = [], defaultJobId: string | null = null): PreviewRow[] {
  const isInvoice = docType === "supplier_invoice";
  return lines.map((line) => {
    const match = matchProduct(line.model_number, products);
    const p = match.product;
    const map = p ? stockUnitFor(p) : null;
    const notes: string[] = [];
    const n = normaliseModel(line.model_number);
    const prev = earlier.find((e) => (p && e.product_id === p.id) || (n && e.normalised === n));
    let action: ReceiveAction = p ? (map?.kind === "labour" ? "skip" : "stock") : "skip";
    let job_id: string | null = null;
    if (prev?.receive_action === "reserve" || prev?.receive_action === "installed") {
      action = prev.receive_action as ReceiveAction; job_id = prev.receive_job_id; notes.push("Job taken from the delivery note");
    } else if (defaultJobId && p?.product_type === "ac_unit") { action = "reserve"; job_id = defaultJobId; }
    if (!p) notes.push(match.lookalikes.length ? `Not in catalogue. Look-alike: ${match.lookalikes.map((x) => x.product_code).join(", ")} (different model, not matched)` : "Not in catalogue");
    else if (match.how === "normalised") notes.push(`Matched ${line.model_number} → ${p.product_code}`);
    let unit_cost_pack: number | null = null; let cost_source: PreviewRow["cost_source"] = "none";
    if (isInvoice && line.unit_price_excl != null) { unit_cost_pack = line.unit_price_excl; cost_source = "invoice"; }
    else if (p?.cost_price != null) { unit_cost_pack = Number(p.cost_price); cost_source = "catalogue"; if (!isInvoice || line.unit_price_excl == null) notes.push("No price on document: catalogue cost used"); }
    const stock_qty = map ? toStockQty(line.qty, map) : line.qty;
    const cost_per_stock_unit = unit_cost_pack != null && map ? costPerStockUnit(unit_cost_pack, map) : unit_cost_pack;
    const expected = prev?.unit_cost_excl ?? (p?.cost_price != null ? Number(p.cost_price) : null);
    const price = isInvoice && cost_source === "invoice" ? priceCheck(unit_cost_pack, expected) : { level: "none" as const, text: "" };
    if (!isInvoice && action === "stock") notes.push("Delivery note: stock is added when the invoice is loaded");
    return { line, match, map, action, job_id, unit_cost_pack, cost_source, stock_qty, cost_per_stock_unit,
      adds_stock: isInvoice && (action === "stock" || action === "reserve"), price, notes };
  });
}

/** Payload for sjd_receive(p_document, p_lines). */
export function toReceivePayload(rows: PreviewRow[], lineIds: Record<number, string>) {
  return rows.filter((r) => lineIds[r.line.line_no]).map((r) => ({
    line_id: lineIds[r.line.line_no], action: r.action, job_id: r.action === "reserve" || r.action === "installed" ? r.job_id : null,
    product_id: r.match.product?.id ?? null, stock_unit: r.map?.stock_unit ?? "each", pack_size: r.map?.pack_size ?? 1,
    qty_packs: r.line.qty, unit_cost_pack: r.unit_cost_pack, cost_source: r.cost_source,
    price_flag: r.price.level === "none" ? null : r.price.level, price_note: r.price.text || null,
  }));
}
export const canConfirm = (rows: PreviewRow[]) =>
  rows.every((r) => r.action === "skip" || r.action === "stock" || !!r.job_id) && rows.some((r) => r.action !== "skip");
