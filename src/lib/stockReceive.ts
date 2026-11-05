import { stockUnitFor, toStockQty, costPerStockUnit, type CatalogueProduct, type UnitMapping } from "./stockUnits";

export type DocType = "delivery_note" | "supplier_invoice" | string;
export type ReceiveAction = "stock" | "reserve" | "installed" | "skip";
/** WALDA buckets. Materials are never reserved to a job. A unit is job-reserved or general stock. */
export type StockBucket = "material_pool" | "job_unit" | "general_unit";

export interface ExtractedLine { line_no: number; description: string; model_number: string | null; qty: number; unit_price_excl: number | null }
export interface Product extends CatalogueProduct { id: string; cost_price?: number | null; product_type?: string | null }

/**
 * Stock key: one stock item per physical model, so indoor (FCMI-24) and outdoor (FCMI-24X) stay separate.
 * Strips spaces/dashes and the supplier packaging suffix -P.   FCMI-24X-P -> FCMI24X
 */
export function stockKey(code: string | null | undefined) {
  return (code ?? "").toUpperCase().replace(/[\s_/.]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").replace(/-P$/, "").replace(/-/g, "");
}
/**
 * Catalogue key: the price-book row covers the indoor+outdoor pair, so also drop the outdoor X suffix.
 * FCMI-24-P, FCMI-24X-P -> FCMI24;  FCMI-L-12X -> FCMIL12 (a different "Lite" model: never merged, only offered as a look-alike)
 */
export function normaliseModel(code: string | null | undefined) {
  const d = (code ?? "").toUpperCase().replace(/[\s_/.]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").replace(/-P$/, "");
  return d.replace(/(\d)X$/, "$1").replace(/-/g, "");
}
/** Loose key for look-alikes only: also drops a single-letter variant (FCMI-L-12 ~ FCMI-12). */
const looseKey = (code: string | null | undefined) =>
  normaliseModel((code ?? "").toUpperCase().replace(/^([A-Z]+)-[A-Z]-(?=\d)/, "$1-"));

export interface Match { product: Product | null; how: "exact" | "normalised" | "alias" | "none"; lookalikes: Product[] }

/**
 * Supplier / superseded code for a catalogue item (table supplier_product_code_aliases).
 * Lets a new supplier code (e.g. a revised machine with the same model name) match the catalogue item without a code deploy.
 * Only used when there is no exact or normalised match; such matches are flagged "alias" and shown as a warning.
 */
export interface CodeAlias { product_id: string; supplier_code: string; half?: "indoor" | "outdoor" | null; supplier_name?: string | null }
/** Samsung split halves end in a letter + N (indoor) or X (outdoor): AR40H12C1AMN / AR40H12C1AMX. Not FCMI-24X (digit + X). */
export const samsungHalf = (code: string | null | undefined): "indoor" | "outdoor" | null => {
  const k = stockKey(code);
  if (!/^AR\d/.test(k)) return null;
  return /[A-Z]X$/.test(k) ? "outdoor" : /[A-Z]N$/.test(k) ? "indoor" : null;
};

/** Match a supplier line to the catalogue. Never guesses across families: FCMI vs FCMF is reported as a look-alike, not a match. */
export function matchProduct(model: string | null, products: Product[], aliases: CodeAlias[] = []): Match {
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
    const sameDigitsOtherFamily = pf !== fam && pn.slice(pf.length) === digits && pf.length === fam.length && editDistance(pf, fam) === 1;
    return sameDigitsOtherFamily || (!hit && looseKey(p.product_code) === looseKey(model));
  });
  if (!hit && aliases.length) {
    const k = stockKey(model);
    const a = aliases.find((x) => stockKey(x.supplier_code) === k);
    const ap = a ? products.find((p) => p.id === a.product_id) ?? null : null;
    if (ap) return { product: ap, how: "alias", lookalikes: [] };
  }
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
  stock_key: string; line: ExtractedLine; match: Match; map: UnitMapping | null; action: ReceiveAction; job_id: string | null;
  bucket: StockBucket | null;
  unit_cost_pack: number | null; cost_source: "invoice" | "catalogue" | "none";
  vat_rate: number; vat_amount: number | null;
  stock_qty: number; cost_per_stock_unit: number | null; adds_stock: boolean; price: PriceFlag; notes: string[];
  /** Serial number(s) as printed on the unit / delivery note; saved per job on receive. */
  serial_no?: string | null;
  half?: "indoor" | "outdoor" | null;
}

/** AC units are job-reserved or general stock. Everything else received goes to the materials pool. */
export function bucketFor(action: ReceiveAction, product: Product | null, map: UnitMapping | null): StockBucket | null {
  if (action === "skip" || !product || map?.kind === "labour") return null;
  if (product.product_type !== "ac_unit") return "material_pool";
  if (action === "reserve" || action === "installed") return "job_unit";
  return "general_unit";
}

/** Line VAT from an exclusive pack cost. Rate is a percent (15 = 15%). */
export function lineVat(unitExcl: number | null, qty: number, rate = 15) {
  if (unitExcl == null) return { vat_rate: rate, vat_amount: null as number | null, line_excl: null as number | null };
  const line_excl = Math.round(unitExcl * qty * 100) / 100;
  const vat_amount = Math.round(line_excl * rate) / 100;
  return { vat_rate: rate, vat_amount, line_excl };
}

/** 9k–36k from a model code. Same rules as stock_unit_size_key in SQL. Metres, kg and amps are not BTU. */
export function stockUnitSizeKey(code: string | null | undefined): string | null {
  const c = (code ?? "").toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  const m = c.match(/(?:^|[^0-9])(36000|24000|18000|12000|9000|36|24|18|12|9)([^0-9]{1,3}|$)/);
  if (!m) return null;
  if (/^(MM|MTR|ML|KG|M|G|W|A)/.test(m[2] ?? "")) return null;
  const n = m[1];
  if (n === "36" || n === "36000") return "36000";
  if (n === "24" || n === "24000") return "24000";
  if (n === "18" || n === "18000") return "18000";
  if (n === "12" || n === "12000") return "12000";
  if (n === "9" || n === "9000") return "9000";
  return null;
}

export function unitHalf(code: string | null | undefined, product: Product | null): "indoor" | "outdoor" | null {
  if (product?.product_type !== "ac_unit") return null;
  const k = stockKey(code);
  return samsungHalf(k) ?? (/\dX$/.test(k) ? "outdoor" : "indoor");
}

/** Snap a row onto one bucket. Materials cannot be reserved to a job. */
export function withBucket<T extends PreviewRow>(row: T): T {
  let action = row.action;
  const bucket = bucketFor(action, row.match.product, row.map);
  if (bucket === "material_pool" && (action === "reserve" || action === "installed")) action = "stock";
  const job_id = bucket === "job_unit" ? row.job_id : null;
  const notes = row.notes.filter((n) => !n.startsWith("Materials pool:") && !n.startsWith("General stock:") && n !== "On site for this job");
  if (bucket === "material_pool") notes.push("Materials pool: not reserved to a job. The install allowance costs the job when it is finished.");
  else if (bucket === "general_unit") notes.push("General stock: not on a job until it is assigned.");
  else if (bucket === "job_unit" && action === "installed") notes.push("On site for this job");
  return { ...row, action, bucket, job_id, notes };
}

/**
 * Build the preview for one document.
 * - Quantity posts on the first of the delivery note or the invoice. The matching document changes cost only.
 * - An invoice before the goods arrive does not count as on-hand stock. A credit note reverses qty and cost.
 * - An invoice line inherits reserve/installed + job from the earlier delivery note line for the same product (same PO).
 */
export function buildPreview(docType: DocType, lines: ExtractedLine[], products: Product[], earlier: EarlierLine[] = [], defaultJobId: string | null = null, aliases: CodeAlias[] = []): PreviewRow[] {
  const isInvoice = docType === "supplier_invoice";
  const isCredit = docType === "credit_note";
  // Indoor+outdoor halves that match one catalogue pair row (stockKey differs, product same).
  const halves = new Map<string, Set<string>>();
  for (const l of lines) { const m = matchProduct(l.model_number, products, aliases).product; if (m) { const k = halves.get(m.id) ?? new Set(); k.add(stockKey(l.model_number)); halves.set(m.id, k); } }
  const pairSum = new Map<string, number | null>();
  for (const [pid, keys] of halves) if (keys.size > 1) {
    const prices = [...keys].map((k) => lines.find((l) => stockKey(l.model_number) === k && matchProduct(l.model_number, products, aliases).product?.id === pid)?.unit_price_excl ?? null);
    pairSum.set(pid, prices.every((p) => p != null) ? prices.reduce((a, p) => a + (p as number), 0) : null);
  }
  return lines.map((line) => {
    const match = matchProduct(line.model_number, products, aliases);
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
    else if (match.how === "alias") notes.push(`Code alias (check): ${line.model_number} → ${p.product_code}. Supplier code differs from the catalogue`);
    let unit_cost_pack: number | null = null; let cost_source: PreviewRow["cost_source"] = "none";
    if ((isInvoice || isCredit) && line.unit_price_excl != null) { unit_cost_pack = line.unit_price_excl; cost_source = "invoice"; }
    else if (p?.cost_price != null) { unit_cost_pack = Number(p.cost_price) / (p && pairSum.has(p.id) ? 2 : 1); cost_source = "catalogue"; if (p && pairSum.has(p.id)) notes.push("Pair price split 50/50 between indoor and outdoor"); if (line.unit_price_excl == null) notes.push("No price on document: catalogue cost used"); }
    if (unit_cost_pack == null && p) notes.push("No cost: flagged, not treated as zero");
    const stock_qty = map ? toStockQty(line.qty, map) : line.qty;
    const cost_per_stock_unit = unit_cost_pack != null && map ? costPerStockUnit(unit_cost_pack, map) : unit_cost_pack;
    const expected = prev?.unit_cost_excl ?? (p?.cost_price != null ? Number(p.cost_price) : null);
    const isPair = !!p && pairSum.has(p.id);
    const price = !(isInvoice && cost_source === "invoice") ? { level: "none" as const, text: "" }
      : isPair ? (pairSum.get(p!.id) == null ? { level: "none" as const, text: "" } : (() => { const f = priceCheck(pairSum.get(p!.id)!, p!.cost_price != null ? Number(p!.cost_price) : expected); return f.level === "none" ? f : { ...f, text: `Pair (indoor + outdoor) ${f.text.replace(/^Invoice /, "")}` }; })())
      : priceCheck(unit_cost_pack, expected);
    const bucket = bucketFor(action, p, map);
    if (bucket === "material_pool") {
      job_id = null;
      if (action === "reserve" || action === "installed") action = "stock";
      notes.push("Materials pool: not reserved to a job. The install allowance costs the job when it is finished.");
    } else if (bucket === "general_unit") {
      job_id = null;
      notes.push("General stock: not on a job until it is assigned.");
    } else if (bucket === "job_unit" && action === "installed") notes.push("On site for this job");
    if (isCredit) notes.push("Credit note reverses quantity and cost");
    else if (!isInvoice) notes.push("Quantity is received on this delivery note when it is first. A later invoice changes the cost only.");
    else notes.push("If the delivery note is already in, this invoice changes the cost only.");
    const vat = lineVat(unit_cost_pack, line.qty);
    const half = unitHalf(line.model_number, p);
    return { stock_key: stockKey(line.model_number) || (line.description ?? "").slice(0, 60).toUpperCase(), line, match, map, action, job_id, bucket, vat_rate: vat.vat_rate, vat_amount: vat.vat_amount,
      unit_cost_pack, cost_source, stock_qty, cost_per_stock_unit,
      adds_stock: !isCredit && bucket != null && action !== "skip" && action !== "installed", price, notes, half };
  });
}

/** Payload for sjd_receive(p_document, p_lines). */
export function toReceivePayload(rows: PreviewRow[], lineIds: Record<number, string>) {
  return rows.filter((r) => lineIds[r.line.line_no]).map((r) => ({
    line_id: lineIds[r.line.line_no], action: r.action, job_id: r.action === "reserve" || r.action === "installed" ? r.job_id : null,
    product_id: r.match.product?.id ?? null, model_code: r.stock_key, item: r.match.product?.short_name || r.match.product?.name || r.line.description, stock_unit: r.map?.stock_unit ?? "each", pack_size: r.map?.pack_size ?? 1,
    qty_packs: r.line.qty, unit_cost_pack: r.unit_cost_pack, cost_source: r.cost_source,
    price_flag: r.price.level === "none" ? null : r.price.level, price_note: r.price.text || null, serial_no: r.serial_no?.trim() || null,
    bucket: r.bucket, vat_rate: r.vat_rate, vat_amount: r.vat_amount, half: r.half ?? null,
  }));
}
export const canConfirm = (rows: PreviewRow[]) =>
  rows.every((r) => {
    if (r.action === "skip") return true;
    if (r.bucket === "material_pool") return r.action === "stock";
    if (r.bucket === "general_unit") return r.action === "stock";
    if (r.bucket === "job_unit" || r.action === "reserve" || r.action === "installed") return !!r.job_id;
    return true;
  }) && rows.some((r) => r.action !== "skip");
