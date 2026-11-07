/**
 * Material check for role homes.
 * Installation: the quoted unit and related lines (pack / stores draw). Nothing is invented.
 * Repair / service: consumables by default. Extra parts only when the quote or the job records them.
 * A first quote visit has no material check.
 * Stock shortfalls are only claimed when on-hand was actually loaded.
 */
import { inSignedInCompany } from "@/lib/adminHomeCount";
import { kindOfJobType } from "@/lib/jobTypeChoice";
import { quoteDrawQty, stockUnitFor, type CatalogueProduct } from "@/lib/stockUnits";

export type CheckKind = "installation" | "service" | "quote_visit";

export interface SourceLine {
  id: string;
  name?: string | null;
  code?: string | null;
  productId?: string | null;
  /** supplier product_type, when the quote line is linked. */
  productType?: string | null;
  itemType?: string | null;
  /** Quote quantity. Null when the quote did not state one. */
  quantity?: number | null;
  /** Metres the quote already states. Never a guessed run. */
  lengthM?: number | null;
  product?: CatalogueProduct | null;
  href?: string | null;
  source: "quote" | "recorded";
}

export interface StockHand {
  id: string;
  label: string;
  productId?: string | null;
  code?: string | null;
  qty: number;
  href?: string | null;
}

export type LineStatus = "ready" | "to_pick" | "unspecified" | "note" | "stock_unknown";

export interface MaterialLine {
  id: string;
  label: string;
  href: string | null;
  status: LineStatus;
  /** Short by this much, only when on-hand and the needed qty are both known. */
  shortQty: number | null;
  needed: number | null;
  onHand: number | null;
  stockId: string | null;
  unit: "each" | "m" | "kg" | "l" | "roll";
}

export interface MaterialCheck {
  kind: CheckKind;
  /** False for a first quote visit: do not render a material check. */
  show: boolean;
  lines: MaterialLine[];
  /** Lines that are a real pick, not the consumable note. */
  toPickCount: number;
}

export interface CheckInput {
  kind: CheckKind;
  lines?: SourceLine[];
  /** Parts logged or requested on this job, not a guessed BOM. */
  recorded?: SourceLine[];
  stock?: StockHand[];
  /** False when stock could not be loaded. Then nothing is marked ready or to-pick. */
  stockKnown: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const txt = (l: Pick<SourceLine, "name" | "code" | "itemType" | "productType">) =>
  `${l.name || ""} ${l.code || ""} ${l.itemType || ""} ${l.productType || ""}`.toLowerCase();

export function checkKindOf(input: {
  jobType?: string | null;
  title?: string | null;
  serviceType?: string | null;
  /** Sales appointment that is a first quote visit, not a booked install. */
  quoteVisit?: boolean;
}): CheckKind {
  if (input.quoteVisit) return "quote_visit";
  const kind = kindOfJobType(input.jobType);
  if (kind === "installation") return "installation";
  if (kind === "service") return "service";
  const blob = `${input.title || ""} ${input.serviceType || ""}`.toLowerCase();
  if (/follow-?up/.test(blob) && !/install/.test(blob)) return "quote_visit";
  if (/quote visit|sales visit|consultation/.test(blob)) return "quote_visit";
  if (/repair|\bservice\b|maintenance/.test(blob)) return "service";
  if (/install/.test(blob)) return "installation";
  return "installation";
}

/** A first sales quote visit does not get a material check. A follow-up that is not an install does not either. */
export function isFirstQuoteVisit(input: { serviceType?: string | null; source?: string | null; title?: string | null }): boolean {
  const blob = `${input.serviceType || ""} ${input.source || ""} ${input.title || ""}`.toLowerCase();
  if (/install/.test(blob) && !/quote visit|consultation/.test(blob)) return false;
  if (/follow/.test(blob)) return true;
  return /quote|consult|sales|visit/.test(blob);
}

function isLabour(l: SourceLine): boolean {
  return l.itemType === "labour" || /\blabou?r\b/.test(txt(l));
}

/** The machine being installed: indoor/outdoor unit, cassette, or an ac_unit product. */
export function isInstallUnit(l: SourceLine): boolean {
  if ((l.productType || "").toLowerCase() === "ac_unit") return true;
  return /\b(indoor|outdoor|cassette|midwall|mid-wall|console|condenser|evaporator|split unit|fan coil)\b/.test(txt(l));
}

/** Copper, brackets, trunking, drain — the new-unit pack, not a repair part. */
export function isInstallMaterial(l: SourceLine): boolean {
  return /\b(copper|trunking|wall bracket|brackets?|drain(?:age)?(?: pipe)?|interconnect|pair coil)\b/.test(txt(l));
}

export function isRefrigerant(l: SourceLine): boolean {
  return /\br-?(?:22|32|134a?|410a?|407c?|404a?|507)\b|\brefrigerant\b/.test(txt(l));
}

export function isRepairPart(l: SourceLine): boolean {
  return /\b(compressor|pcb|pc board|circuit board|control board|capacitor|fan motor|sensor|contactor|expansion valve|reversing valve|thermistor)\b/.test(txt(l));
}

function vagueName(name: string): boolean {
  return /^(unit|indoor|outdoor|indoor unit|outdoor unit|cassette|ac|aircon|air conditioner|part|material|item|pipe|copper|copper pipe)$/i.test(name.trim());
}

function numOrNull(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n);
}

function trimNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

interface Need {
  qty: number | null;
  unit: MaterialLine["unit"];
  unspecified: boolean;
  reason: string | null;
}

/** Needed qty in stock units. A missing run length or unstated gas kg stays unspecified. */
export function neededOf(l: SourceLine): Need {
  const length = numOrNull(l.lengthM);
  const pipe = /\b(copper|pipe|trunking|drain)\b/.test(txt(l));
  if (pipe && length == null && !l.product?.sold_in_length) {
    const q = numOrNull(l.quantity);
    if (!(q != null && q > 0)) return { qty: null, unit: "m", unspecified: true, reason: "length not on the quote" };
  }
  if (l.product && isRefrigerant(l)) {
    const map = stockUnitFor(l.product);
    const q = numOrNull(l.quantity);
    if (map.stock_unit === "kg") {
      const drawn = q == null ? 0 : quoteDrawQty(q, l.product, map, l.name || "");
      if (!(drawn > 0)) return { qty: null, unit: "kg", unspecified: true, reason: "quantity not on the quote" };
      return { qty: drawn, unit: "kg", unspecified: false, reason: null };
    }
  }
  if (length != null) {
    if (!(length > 0)) return { qty: null, unit: "m", unspecified: true, reason: "length not on the quote" };
    return { qty: length, unit: "m", unspecified: false, reason: null };
  }
  const product = l.product;
  if (product?.sold_in_length) {
    const q = numOrNull(l.quantity);
    if (!(q != null && q > 0)) return { qty: null, unit: "m", unspecified: true, reason: "length not on the quote" };
    return { qty: q, unit: "m", unspecified: false, reason: null };
  }
  const q = numOrNull(l.quantity);
  if (!(q != null && q > 0)) return { qty: null, unit: "each", unspecified: true, reason: "quantity not on the quote" };
  if (product) {
    const map = stockUnitFor(product);
    if (map.kind === "labour") return { qty: null, unit: "each", unspecified: true, reason: null };
    return { qty: quoteDrawQty(q, product, map, l.name || "") || q, unit: map.stock_unit, unspecified: false, reason: null };
  }
  return { qty: q, unit: "each", unspecified: false, reason: null };
}

function labelOf(l: SourceLine, need: Need): string {
  const name = (l.name || "").trim();
  const code = (l.code || "").trim();
  const head = name && code && norm(name) !== norm(code) ? `${name} · ${code}` : (name || code || "Item");
  if (need.reason === "length not on the quote") return `${head} · ${need.reason}`;
  if (need.unspecified && (!name || vagueName(name)) && !code) {
    return `${name || "Item"} · not specified on the quote`;
  }
  if (need.reason && need.qty == null) return `${head} · ${need.reason}`;
  if (need.unit === "m" && need.qty != null) return `${head} · ${trimNum(need.qty)} m`;
  if (need.unit === "kg" && need.qty != null) return `${head} · ${trimNum(need.qty)} kg`;
  if (need.qty != null && need.unit === "each") {
    const n = trimNum(need.qty);
    const set = /bracket/.test(txt(l)) ? "set" : null;
    return set ? `${head} · ${n} ${set}` : `${head} · ${n}`;
  }
  return head;
}

function matchStock(l: SourceLine, stock: StockHand[]): StockHand | null {
  if (l.productId) {
    const hit = stock.find((s) => s.productId && s.productId === l.productId);
    if (hit) return hit;
  }
  const code = norm(l.code || "");
  if (code.length >= 3) {
    const hit = stock.find((s) => norm(s.code || "") === code || norm(s.label).includes(code));
    if (hit) return hit;
  }
  const name = norm(l.name || "");
  if (name.length >= 6) {
    const hit = stock.find((s) => {
      const lab = norm(s.label);
      return lab === name || lab.includes(name) || name.includes(lab);
    });
    if (hit) return hit;
  }
  return null;
}

const CONSUMABLE_NOTE =
  "Typical repair consumables: R410 or R32 gas, and similar. Which gas is not on this job.";

function pushLine(out: MaterialLine[], l: SourceLine, stock: StockHand[], stockKnown: boolean) {
  const need = neededOf(l);
  const nameVague = !(l.name || "").trim() || (vagueName(l.name || "") && !(l.code || "").trim() && !l.productId);
  const unspecified = nameVague || (need.unspecified && need.qty == null);
  const hand = unspecified ? null : matchStock(l, stock);
  let status: LineStatus = "stock_unknown";
  let shortQty: number | null = null;
  let onHand: number | null = null;
  if (unspecified && need.qty == null) status = "unspecified";
  else if (!stockKnown) status = "stock_unknown";
  else if (!hand) {
    status = "to_pick";
    shortQty = need.qty;
    onHand = 0;
  } else {
    onHand = Number(hand.qty) || 0;
    if (need.qty == null) status = "unspecified";
    else if (onHand >= need.qty - 1e-9) status = "ready";
    else {
      status = "to_pick";
      shortQty = Math.round((need.qty - onHand) * 1000) / 1000;
    }
  }
  out.push({
    id: l.id,
    label: labelOf(l, need),
    href: l.href || null,
    status,
    shortQty,
    needed: need.qty,
    onHand,
    stockId: hand?.id || null,
    unit: need.unit,
  });
}

function serviceLines(lines: SourceLine[]): SourceLine[] {
  return lines.filter((l) => {
    if (isLabour(l)) return false;
    if (l.source === "recorded") return !isInstallUnit(l);
    if (isInstallUnit(l) || isInstallMaterial(l)) return false;
    if (isRefrigerant(l) || isRepairPart(l)) return true;
    // Any other quoted line was put on this job on purpose (a named part), not a guessed pack.
    return true;
  });
}

export function buildMaterialCheck(input: CheckInput): MaterialCheck {
  if (input.kind === "quote_visit") return { kind: "quote_visit", show: false, lines: [], toPickCount: 0 };
  const stock = input.stock || [];
  const quoted = (input.lines || []).filter((l) => !isLabour(l));
  const recorded = (input.recorded || []).filter((l) => !isLabour(l));
  const lines: MaterialLine[] = [];
  if (input.kind === "installation") {
    const seen = new Set<string>();
    for (const l of [...quoted, ...recorded]) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      pushLine(lines, l, stock, input.stockKnown);
    }
    if (!lines.length) {
      lines.push({
        id: "none",
        label: "No materials on this quote",
        href: null,
        status: "unspecified",
        shortQty: null,
        needed: null,
        onHand: null,
        stockId: null,
        unit: "each",
      });
    }
  } else {
    const picked = serviceLines([...quoted, ...recorded]);
    const namedGas = picked.some((l) => isRefrigerant(l));
    for (const l of picked) pushLine(lines, l, stock, input.stockKnown);
    if (!namedGas) {
      lines.unshift({
        id: "repair-consumables",
        label: CONSUMABLE_NOTE,
        href: null,
        status: "note",
        shortQty: null,
        needed: null,
        onHand: null,
        stockId: null,
        unit: "each",
      });
    }
  }
  const toPickCount = lines.filter((l) => l.status === "to_pick").length;
  return { kind: input.kind, show: true, lines, toPickCount };
}

export function checkSummary(check: MaterialCheck): { label: string; tone: "ready" | "warn" | "neutral" } | null {
  if (!check.show) return null;
  if (check.kind === "service") {
    const real = check.lines.filter((l) => l.status !== "note");
    if (check.toPickCount > 0) {
      return { label: `${check.toPickCount} part${check.toPickCount === 1 ? "" : "s"} to pick`, tone: "warn" };
    }
    if (real.some((l) => l.status === "ready") && real.every((l) => l.status === "ready")) return { label: "Parts ready", tone: "ready" };
    if (!real.length || real.every((l) => l.status === "note")) return { label: "Consumables", tone: "neutral" };
    if (real.some((l) => l.status === "unspecified" || l.status === "stock_unknown")) return { label: "Consumables", tone: "neutral" };
  }
  if (check.toPickCount > 0) return { label: `${check.toPickCount} part${check.toPickCount === 1 ? "" : "s"} to pick`, tone: "warn" };
  if (check.lines.some((l) => l.status === "ready") && check.lines.every((l) => l.status === "ready" || l.status === "note")) {
    return { label: "Parts ready", tone: "ready" };
  }
  if (check.lines.some((l) => l.status === "unspecified")) return { label: "Not fully specified", tone: "warn" };
  return { label: "Consumables", tone: "neutral" };
}

export interface WeekJobInput {
  id: string;
  href: string;
  company_id?: string | null;
  kind: CheckKind;
  lines?: SourceLine[];
  recorded?: SourceLine[];
  stock?: StockHand[];
  stockKnown: boolean;
}

export interface StockOrder {
  key: string;
  label: string;
  detail: string;
  href: string;
}

export interface StockLevel {
  key: string;
  name: string;
  detail: string;
  short: number | null;
  href: string;
}

interface Agg {
  key: string;
  name: string;
  unit: MaterialLine["unit"];
  needed: number;
  onHand: number | null;
  qtyKnown: boolean;
  href: string;
  stockHref: string | null;
  kinds: Set<CheckKind>;
}

/** Company-scoped. Quote visits add nothing. Unspecified lengths are not turned into metres. */
export function stockNeedsFromChecks(companyId: string, jobs: { href: string; kind: CheckKind; company_id?: string | null; check: MaterialCheck }[]): { orders: StockOrder[]; levels: StockLevel[] } {
  const map = new Map<string, Agg>();
  for (const job of jobs) {
    if (!inSignedInCompany(job.company_id, companyId)) continue;
    if (job.kind === "quote_visit" || !job.check.show) continue;
    for (const line of job.check.lines) {
      if (line.status !== "to_pick" && line.status !== "ready") continue;
      if (line.needed == null) continue;
      const key = line.stockId || norm(line.label);
      const cur = map.get(key) || {
        key,
        name: line.label.replace(/ · .*$/, ""),
        unit: line.unit,
        needed: 0,
        onHand: line.onHand,
        qtyKnown: true,
        href: job.href,
        stockHref: line.stockId ? `/admin/cash-health?tab=stock#stock-${line.stockId}` : null,
        kinds: new Set<CheckKind>(),
      };
      cur.needed = Math.round((cur.needed + line.needed) * 1000) / 1000;
      if (line.onHand != null) cur.onHand = line.onHand;
      cur.kinds.add(job.kind);
      map.set(key, cur);
    }
  }
  const orders: StockOrder[] = [];
  const levels: StockLevel[] = [];
  for (const a of map.values()) {
    const install = a.kinds.has("installation") && !a.kinds.has("service");
    const detail = install ? "For booked installations" : a.kinds.has("service") && !a.kinds.has("installation") ? "For this week's repairs" : "For this week's jobs";
    const short = a.onHand == null ? null : Math.max(0, Math.round((a.needed - a.onHand) * 1000) / 1000);
    const qty = a.unit === "m" ? `${trimNum(a.needed)} m × ${a.name}` : `${trimNum(a.needed)} × ${a.name}`;
    if (short == null || short > 0) orders.push({ key: a.key, label: qty, detail, href: a.href });
    const handTxt = a.onHand == null ? "on hand not loaded" : `${trimNum(a.onHand)} in stock`;
    const needTxt = a.unit === "m" ? `${trimNum(a.needed)} m needed this week` : `${trimNum(a.needed)} needed this week`;
    levels.push({
      key: a.key,
      name: a.name,
      detail: `${handTxt} · ${needTxt}`,
      short,
      href: a.stockHref || a.href,
    });
  }
  orders.sort((x, y) => x.label.localeCompare(y.label));
  levels.sort((x, y) => x.name.localeCompare(y.name));
  return { orders, levels };
}

/** Company-scoped. Quote visits add nothing. Unspecified lengths are not turned into metres. */
export function stockNeedsForWeek(companyId: string, jobs: WeekJobInput[]): { orders: StockOrder[]; levels: StockLevel[] } {
  return stockNeedsFromChecks(companyId, jobs.map((job) => ({
    href: job.href,
    kind: job.kind,
    company_id: job.company_id,
    check: buildMaterialCheck(job),
  })));
}
