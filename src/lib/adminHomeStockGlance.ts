/**
 * Admin-home stock glance.
 * Pure. On hand comes from the stock ledger (materials pool + general units).
 * What upcoming jobs need comes from their quote lines, kit pipe sizes and
 * active material allowances — never a hard-coded 9 000 BTU bill of materials.
 * A missing run length is reported and is not filled in as 10 m.
 * Small items (pipe, lagging, cable, bolts and the like) carry a loss estimate:
 * what finished jobs were expected to use versus what stock movements show left
 * the shelf, plus a count gap when a stock count exists. That figure is rough.
 */
import { pipeFraction, pipePairFromText } from "@/lib/kitSizes";
import { classifyQuoteCategory } from "@/lib/pricing";
import { jobHref } from "@/lib/recordLinks";
import { samsungHalf, stockUnitSizeKey } from "@/lib/stockReceive";
import { quoteDrawQty, stockUnitFor, type CatalogueProduct } from "@/lib/stockUnits";
import { rowInCompany, TEST_HVAC_ID } from "@/lib/adminHomeCashFlow";

const DONE = new Set(["completed", "complete", "cancelled", "canceled", "void"]);
const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export interface StockJob {
  id: string;
  company_id?: string | null;
  title?: string | null;
  status?: string | null;
  quote_id?: string | null;
  invoice_id?: string | null;
  job_type?: string | null;
  customer_name?: string | null;
}

export interface StockQuoteLine {
  id: string;
  quote_id: string;
  item_name: string;
  description?: string | null;
  item_type?: string | null;
  item_number?: string | null;
  quantity?: number | string | null;
  length?: number | string | null;
  product_id?: string | null;
  is_bundle?: boolean | null;
  parent_item_id?: string | null;
  price_per_unit_label?: string | null;
  metadata?: { quote_category?: string | null; length_m?: number | null; kit_length?: number | null; kitLength?: number | null } | null;
  product_category?: string | null;
  category?: string | null;
  product_code?: string | null;
  supplier_type?: string | null;
  product_type?: string | null;
  pipe_liquid?: string | null;
  pipe_gas?: string | null;
  sold_in_length?: boolean | null;
  unit_length?: number | null;
  short_name?: string | null;
  half?: "indoor" | "outdoor" | null;
}

export interface StockAllowance {
  id: string;
  company_id?: string | null;
  job_type?: string | null;
  unit_size?: string | null;
  item_label: string;
  stock_unit?: string | null;
  qty?: number | string | null;
  product_id?: string | null;
  active?: boolean | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface StockItemRow {
  id: string;
  company_id?: string | null;
  label: string;
  product_id?: string | null;
  unit?: string | null;
  /** cf_stock_items.qty_on_hand — used only when the ledger has no movements for the item. */
  cache_on_hand?: number | string | null;
  minimum?: number | string | null;
}

export interface StockMove {
  company_id?: string | null;
  stock_item_id?: string | null;
  product_id?: string | null;
  job_id?: string | null;
  bucket?: string | null;
  kind?: string | null;
  qty?: number | string | null;
  item_label?: string | null;
}

export interface CountGapInput {
  company_id?: string | null;
  stock_item_id: string;
  system_qty?: number | string | null;
  counted_qty?: number | string | null;
}

export interface StockJobDraw {
  jobId: string;
  label: string;
  href: string;
  qty: number;
  note: string | null;
}

export interface StockLoss {
  expected: number;
  actual: number;
  /** Actual drawn minus what the finished jobs' lines said. Positive means more left the shelf than the lines. */
  variance: number;
  /** Counted minus the books. Negative means the count was short. Null when no count. */
  countGap: number | null;
}

export interface StockCandle {
  key: string;
  label: string;
  unit: string;
  onHand: number;
  needed: number;
  minimum: number | null;
  stockItemId: string | null;
  href: string;
  jobs: StockJobDraw[];
  loss: StockLoss | null;
  small: boolean;
  gaps: string[];
}

export interface StockGap {
  id: string;
  label: string;
  detail: string;
  href: string;
}

export interface StockGlance {
  candles: StockCandle[];
  gaps: StockGap[];
  onHandNote: string;
}

const SHELF = new Set(["material_pool", "general_unit"]);

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function upcoming(job: StockJob): boolean {
  return !DONE.has(String(job.status || "").toLowerCase());
}

function finished(job: StockJob): boolean {
  const s = String(job.status || "").toLowerCase();
  return s === "completed" || s === "complete";
}

export function isSmallStock(label: string, unit?: string | null): boolean {
  if (/\b(bolt|nut|washer|screw|nail|pipe|copper|lagging|arma\s?flex|insulation|cable|cabtyre|trunking|bracket|drain|core)\b/i.test(label)) return true;
  return unit === "m" || unit === "roll";
}

function isUnit(line: StockQuoteLine): boolean {
  if (line.product_type === "ac_unit") return true;
  return classifyQuoteCategory({
    product_category: line.product_category,
    category: line.category,
    item_type: line.item_type,
    quote_category: line.metadata?.quote_category,
    item_name: line.item_name,
    short_name: line.short_name,
    product_code: line.product_code,
    description: line.description,
    supplier_type: line.supplier_type,
    is_bundle: line.is_bundle,
  }) === "units";
}

function isLabourOrCallout(line: StockQuoteLine): boolean {
  return classifyQuoteCategory({
    product_category: line.product_category,
    category: line.category,
    item_type: line.item_type,
    quote_category: line.metadata?.quote_category,
    item_name: line.item_name,
    short_name: line.short_name,
    product_code: line.product_code,
    description: line.description,
    supplier_type: line.supplier_type,
    is_bundle: false,
  }) === "labour";
}

/** Run length already stored on the line. Never invented. */
export function runMetres(line: StockQuoteLine): number | null {
  const length = num(line.length);
  if (length > 0) return r3(length);
  const md = line.metadata || {};
  for (const v of [md.length_m, md.kit_length, md.kitLength]) {
    if (num(v) > 0) return r3(num(v));
  }
  const label = String(line.price_per_unit_label || "").toLowerCase();
  const perMetre = label === "m" || label === "metre" || label === "meter" || !!line.sold_in_length;
  if (perMetre && num(line.quantity) > 0) return r3(num(line.quantity));
  return null;
}

function wantsRun(line: StockQuoteLine): boolean {
  const blob = `${line.item_name} ${line.description || ""} ${line.short_name || ""}`;
  if (/\b(bolt|nut|washer|screw|bracket)\b/i.test(blob) && !/\b(pipe|copper|cable|lagging|trunking)\b/i.test(blob)) return false;
  return /\b(pipe|copper|piping|kit|lagging|arma\s?flex|insulation|cable|cabtyre|trunking|drain)\b/i.test(blob) || !!line.is_bundle;
}

function pairOf(line: StockQuoteLine): [string, string] | null {
  const a = pipeFraction(line.pipe_liquid);
  const b = pipeFraction(line.pipe_gas);
  if (a && b && a !== b) return [a, b].sort((x, y) => frac(x) - frac(y)) as [string, string];
  const fromName = pipePairFromText(`${line.item_name} ${line.description || ""} ${line.short_name || ""}`);
  if (!fromName) return null;
  return [fromName.liquid, fromName.gas];
}

function frac(f: string): number {
  const [a, b] = f.split("/").map(Number);
  return a / b;
}

function productOf(line: StockQuoteLine): CatalogueProduct {
  return {
    product_code: line.product_code,
    short_name: line.short_name || line.item_name,
    name: line.item_name,
    description: line.description,
    price_per_unit_label: line.price_per_unit_label,
    sold_in_length: line.sold_in_length,
    unit_length: line.unit_length,
  };
}

interface Need {
  key: string;
  label: string;
  unit: string;
  qty: number;
  productId: string | null;
  jobId: string;
  note: string | null;
}

interface Gap {
  id: string;
  jobId: string;
  detail: string;
}

function halfOf(line: StockQuoteLine): "indoor" | "outdoor" | null {
  if (line.half) return line.half;
  return samsungHalf(line.product_code || line.item_number) ?? (/\dX$/i.test(String(line.product_code || "")) ? "outdoor" : null);
}

function jobNeeds(job: StockJob, lines: StockQuoteLine[], allowances: StockAllowance[], today: string): { needs: Need[]; gaps: Gap[] } {
  const needs: Need[] = [];
  const gaps: Gap[] = [];
  const children = new Set(lines.map((l) => l.parent_item_id).filter(Boolean) as string[]);
  const push = (n: Need) => {
    const hit = needs.find((x) => x.key === n.key);
    if (hit) hit.qty = r3(hit.qty + n.qty);
    else needs.push({ ...n, qty: r3(n.qty) });
  };
  for (const line of lines) {
    if (isLabourOrCallout(line)) continue;
    if (line.is_bundle && children.has(line.id)) continue;
    if (isUnit(line) && !line.is_bundle) {
      const qty = Math.max(0, num(line.quantity) || 1);
      push({ key: line.product_id ? `p:${line.product_id}` : `name:${norm(line.item_name)}`, label: line.short_name || line.item_name, unit: "each", qty, productId: line.product_id || null, jobId: job.id, note: null });
      continue;
    }
    if (line.is_bundle || wantsRun(line)) {
      const metres = runMetres(line);
      const pair = pairOf(line);
      if (pair && metres == null) {
        gaps.push({ id: `${job.id}:${line.id}`, jobId: job.id, detail: `${line.item_name}: run length is not on this line, so pipe is not counted` });
        continue;
      }
      if (pair && metres != null) {
        for (const size of pair) push({ key: `pipe:${size}`, label: `Copper ${size}`, unit: "m", qty: metres, productId: null, jobId: job.id, note: `${metres} m from the pipe sizes on the line` });
        continue;
      }
      if (metres == null && !line.product_id) {
        gaps.push({ id: `${job.id}:${line.id}`, jobId: job.id, detail: `${line.item_name}: run length is not on this line` });
        continue;
      }
    }
    const metres = runMetres(line);
    const perMetre = metres != null && (line.sold_in_length || /^(m|metre|meter)$/i.test(String(line.price_per_unit_label || "")) || wantsRun(line));
    const qty = perMetre ? metres! : quoteDrawQty(num(line.quantity), productOf(line), stockUnitFor(productOf(line)), line.item_name);
    if (!(qty > 0)) {
      if (wantsRun(line)) gaps.push({ id: `${job.id}:${line.id}`, jobId: job.id, detail: `${line.item_name}: run length is not on this line` });
      continue;
    }
    const unit = perMetre ? "m" : stockUnitFor(productOf(line)).stock_unit;
    push({
      key: line.product_id ? `p:${line.product_id}` : `name:${norm(line.item_name)}`,
      label: line.short_name || line.item_name,
      unit, qty, productId: line.product_id || null, jobId: job.id, note: null,
    });
  }
  const hasMaterial = needs.some((n) => n.unit !== "each" || isSmallStock(n.label, n.unit));
  const hasUnit = lines.some((l) => isUnit(l) && !l.is_bundle);
  if (hasUnit && !hasMaterial && !gaps.length) {
    gaps.push({ id: `${job.id}:no-materials`, jobId: job.id, detail: "No pipe, lagging or cable line on this job. Nothing was invented from the unit size." });
  }
  const systems = systemCounts(lines);
  for (const a of allowances) {
    if (!a.active || !(num(a.qty) > 0)) continue;
    if (a.effective_from && a.effective_from > today) continue;
    if (a.effective_to && a.effective_to < today) continue;
    if (a.job_type && job.job_type && a.job_type !== job.job_type && !sameJobType(a.job_type, job.job_type)) continue;
    const systemsN = a.unit_size ? (systems.get(a.unit_size) || 0) : [...systems.values()].reduce((s, n) => s + n, 0);
    if (!(systemsN > 0)) continue;
    const word = a.item_label.toLowerCase().split(/\s+/)[0].replace(/s$/, "");
    if (word && needs.some((n) => n.label.toLowerCase().includes(word) || (a.product_id && n.productId === a.product_id))) continue;
    push({
      key: a.product_id ? `p:${a.product_id}` : `allow:${norm(a.item_label)}`,
      label: a.item_label,
      unit: a.stock_unit || "each",
      qty: r3(num(a.qty) * systemsN),
      productId: a.product_id || null,
      jobId: job.id,
      note: "Active install allowance",
    });
  }
  return { needs, gaps };
}

function sameJobType(allowance: string, job: string): boolean {
  const a = allowance.toLowerCase();
  const j = job.toLowerCase();
  if (a === "install" || a === "installation") return /install/.test(j);
  if (a === "service") return /service|repair|maintenance/.test(j);
  return a === j;
}

function systemCounts(lines: StockQuoteLine[]): Map<string, number> {
  const indoor = new Map<string, number>();
  const outdoor = new Map<string, number>();
  const plain = new Map<string, number>();
  let anyHalf = false;
  for (const line of lines) {
    if (!isUnit(line) || line.is_bundle) continue;
    const size = stockUnitSizeKey(line.product_code || line.item_number || line.item_name);
    if (!size) continue;
    const qty = Math.max(0, num(line.quantity) || 1);
    const half = halfOf(line);
    if (half) {
      anyHalf = true;
      const m = half === "indoor" ? indoor : outdoor;
      m.set(size, (m.get(size) || 0) + qty);
    } else plain.set(size, (plain.get(size) || 0) + qty);
  }
  const sizes = new Set([...indoor.keys(), ...outdoor.keys(), ...plain.keys()]);
  const out = new Map<string, number>();
  for (const size of sizes) {
    const n = anyHalf ? Math.max(indoor.get(size) || 0, outdoor.get(size) || 0, plain.get(size) || 0) : (plain.get(size) || 0);
    if (n > 0) out.set(size, n);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function matchItem(need: Need, items: StockItemRow[]): StockItemRow | null {
  const byProduct = need.productId ? items.find((i) => i.product_id === need.productId) : undefined;
  if (byProduct) return byProduct;
  const size = pipeFraction(need.label);
  const hits = items.filter((i) => {
    if (size && pipeFraction(i.label) === size && /copper|pipe/i.test(`${need.label} ${i.label}`)) return true;
    return norm(i.label) === norm(need.label);
  });
  return hits.length === 1 ? hits[0] : null;
}

function jobLabel(job: StockJob): string {
  return [job.title || "Job", job.customer_name].filter(Boolean).join(" · ");
}

export function buildStockGlance(input: {
  companyId: string;
  today?: string;
  jobs?: StockJob[];
  lines?: StockQuoteLine[];
  allowances?: StockAllowance[];
  items?: StockItemRow[];
  moves?: StockMove[];
  counts?: CountGapInput[];
}): StockGlance {
  const companyId = input.companyId;
  if (!companyId || companyId === TEST_HVAC_ID) return { candles: [], gaps: [], onHandNote: "No company." };
  const today = input.today || "2026-11-06";
  const jobs = (input.jobs || []).filter((j) => rowInCompany(companyId, j.company_id));
  const jobByQuote = new Map<string, StockJob[]>();
  for (const j of jobs) if (j.quote_id) {
    const list = jobByQuote.get(j.quote_id) || [];
    list.push(j);
    jobByQuote.set(j.quote_id, list);
  }
  const lines = input.lines || [];
  const allowances = (input.allowances || []).filter((a) => rowInCompany(companyId, a.company_id));
  const items = (input.items || []).filter((i) => rowInCompany(companyId, i.company_id));
  const moves = (input.moves || []).filter((m) => rowInCompany(companyId, m.company_id));
  const counts = (input.counts || []).filter((c) => !c.company_id || rowInCompany(companyId, c.company_id));

  const onHandByItem = new Map<string, number>();
  const ledgerSeen = new Set<string>();
  for (const m of moves) {
    if (!m.stock_item_id || !SHELF.has(String(m.bucket || ""))) continue;
    ledgerSeen.add(m.stock_item_id);
    onHandByItem.set(m.stock_item_id, r3((onHandByItem.get(m.stock_item_id) || 0) + num(m.qty)));
  }
  for (const item of items) {
    if (!ledgerSeen.has(item.id)) onHandByItem.set(item.id, r3(num(item.cache_on_hand)));
  }

  const drawn = (jobId: string, item: StockItemRow | null, need: Need) => {
    let n = 0;
    for (const m of moves) {
      if (m.job_id !== jobId) continue;
      const mine = (item && m.stock_item_id === item.id) || (need.productId && m.product_id === need.productId);
      if (!mine) continue;
      if (m.kind === "use" && num(m.qty) < 0) n += -num(m.qty);
      if (m.kind === "allocate" && m.bucket === "job_unit" && num(m.qty) > 0) n += num(m.qty);
    }
    return r3(n);
  };

  type Acc = {
    key: string; label: string; unit: string; stockItemId: string | null; href: string;
    needed: number; jobs: StockJobDraw[]; gaps: string[];
    expected: number; actual: number;
  };
  const acc = new Map<string, Acc>();
  const gaps: StockGap[] = [];
  const ensure = (key: string, label: string, unit: string, item: StockItemRow | null): Acc => {
    const hit = acc.get(key);
    if (hit) return hit;
    const row: Acc = {
      key, label: item?.label || label, unit: item?.unit || unit,
      stockItemId: item?.id || null,
      href: "/admin/stock-count",
      needed: 0, jobs: [], gaps: [], expected: 0, actual: 0,
    };
    acc.set(key, row);
    return row;
  };

  for (const job of jobs) {
    const mine = lines.filter((l) => job.quote_id && l.quote_id === job.quote_id);
    const built = jobNeeds(job, mine, allowances, today);
    for (const g of built.gaps) {
      gaps.push({ id: g.id, label: jobLabel(job), detail: g.detail, href: jobHref(job.id) });
    }
    for (const need of built.needs) {
      const item = matchItem(need, items);
      const key = item?.id || need.key;
      const row = ensure(key, need.label, need.unit, item);
      const used = drawn(job.id, item, need);
      const left = r3(Math.max(0, need.qty - used));
      if (upcoming(job)) {
        row.needed = r3(row.needed + left);
        if (left > 0 || need.note) row.jobs.push({ jobId: job.id, label: jobLabel(job), href: jobHref(job.id), qty: left, note: need.note });
      }
      if (finished(job)) row.expected = r3(row.expected + need.qty);
    }
  }

  for (const m of moves) {
    if (m.kind !== "use" || !(num(m.qty) < 0)) continue;
    const job = jobs.find((j) => j.id === m.job_id);
    if (m.job_id && (!job || !finished(job))) continue;
    const item = items.find((i) => i.id === m.stock_item_id);
    const key = item?.id || (m.stock_item_id ? m.stock_item_id : `move:${norm(m.item_label || "")}`);
    if (!key) continue;
    const row = ensure(key, item?.label || m.item_label || "Stock", item?.unit || "each", item || null);
    row.actual = r3(row.actual + -num(m.qty));
  }

  const countByItem = new Map<string, number>();
  for (const c of counts) {
    countByItem.set(c.stock_item_id, r3(num(c.counted_qty) - num(c.system_qty)));
  }

  const candles: StockCandle[] = [];
  const seenItems = new Set<string>();
  for (const [key, row] of acc) {
    if (row.stockItemId) seenItems.add(row.stockItemId);
    const item = items.find((i) => i.id === row.stockItemId);
    const onHand = row.stockItemId ? r3(onHandByItem.get(row.stockItemId) || 0) : 0;
    const minimum = item && item.minimum != null && item.minimum !== "" ? r3(num(item.minimum)) : null;
    const small = isSmallStock(row.label, row.unit);
    const loss = small && (row.expected > 0 || row.actual > 0 || (row.stockItemId && countByItem.has(row.stockItemId)))
      ? { expected: row.expected, actual: row.actual, variance: r3(row.actual - row.expected), countGap: row.stockItemId && countByItem.has(row.stockItemId) ? countByItem.get(row.stockItemId)! : null }
      : null;
    if (!(onHand > 0) && !(row.needed > 0) && minimum == null && !loss) continue;
    candles.push({
      key, label: row.label, unit: row.unit, onHand, needed: row.needed, minimum,
      stockItemId: row.stockItemId, href: row.href, jobs: row.jobs, loss, small, gaps: row.gaps,
    });
  }
  for (const item of items) {
    if (seenItems.has(item.id)) continue;
    const onHand = r3(onHandByItem.get(item.id) || 0);
    const minimum = item.minimum != null && item.minimum !== "" ? r3(num(item.minimum)) : null;
    if (!(onHand > 0) && minimum == null) continue;
    const small = isSmallStock(item.label, item.unit);
    const countGap = countByItem.has(item.id) ? countByItem.get(item.id)! : null;
    candles.push({
      key: item.id, label: item.label, unit: item.unit || "each", onHand, needed: 0, minimum,
      stockItemId: item.id, href: "/admin/stock-count", jobs: [],
      loss: small && countGap != null ? { expected: 0, actual: 0, variance: 0, countGap } : null,
      small, gaps: [],
    });
  }
  candles.sort((a, b) => (b.needed - b.onHand) - (a.needed - a.onHand) || a.label.localeCompare(b.label));
  const usedLedger = moves.some((m) => SHELF.has(String(m.bucket || "")));
  return {
    candles, gaps,
    onHandNote: usedLedger
      ? "On hand is the stock ledger: materials pool plus general units. Units already moved onto a job are not still on the shelf."
      : "On hand is the stock-item quantity, because this company has no shelf movements yet.",
  };
}

export function formatQty(n: number, unit: string): string {
  const v = r3(n);
  const body = Number.isInteger(v) ? String(v) : String(v);
  return `${body} ${unit}`;
}

export const STOCK_RULE = "On hand is what this company has in the materials pool and in general units. Needed is what upcoming jobs still have to draw, from the quote lines already on those jobs (pipe sizes and run length when the line has them) and from active install allowances. A minimum shows only when one is set. Nothing is invented: a 9 000 BTU unit does not grow a pipe list, and a missing run length is not filled in as 10 m. Pipe, lagging, cable, brackets and small fixings will not count exactly — the loss line is an estimate of what finished jobs were meant to use against what the movements say left the shelf.";
