/**
 * Mark completed: book days and materials by adding new rows, or by replacing this job's rows.
 * Existing rows are never edited in place. Calendars read job_schedules. Stock draws use
 * job_materials_used + cf_stock_items.qty_on_hand (the same draw the job already uses).
 * Dates and times are Johannesburg wall-clock values, the way job_schedules stores them.
 */
import { isInstallMaterial, isInstallUnit, isRefrigerant, type CheckKind, type SourceLine } from "@/lib/materialCheck";
import { visitsError, type JobVisit } from "@/lib/jobVisits";

export type ApplyMode = "keep_add" | "override";

export type VisitInput = { date: string; start: string; end: string };
export type ExistingVisit = { id: string; date: string; start: string; end: string };

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Plain Johannesburg calendar label. The date is already a JHB day, not an instant. */
export function visitLabel(date: string, start: string, end: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return `${date}, ${start}–${end}`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEK[dt.getUTCDay()]} ${d} ${MON[m - 1]} ${y}, ${start}–${end}`;
}

export function needsScheduleChoice(existingCount: number): boolean {
  return existingCount > 0;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** One new day to type into. Not a copy of an existing row, so Add cannot rewrite it. */
export function newVisitSeed(existing: ExistingVisit[], finishDate: string): VisitInput {
  const sorted = [...existing].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const last = sorted.at(-1);
  const taken = new Set(existing.map((v) => v.date));
  const start = last?.start || "08:00";
  const end = last?.end || "11:00";
  let date = last ? addDays(last.date, 1) : finishDate;
  if (date > finishDate) date = finishDate;
  for (let i = 0; i < 14 && taken.has(date); i++) {
    const prev = addDays(date, -1);
    if (prev >= "2000-01-01") date = prev;
  }
  return { date, start, end };
}

export function validateVisits(visits: VisitInput[], finishDate: string): string | null {
  const asJob: JobVisit[] = visits.map((v) => ({ date: v.date, start: v.start, end: v.end }));
  const err = visitsError(asJob);
  if (err) return err;
  for (const v of visits) {
    if (finishDate && v.date > finishDate) return "A work day can't be after the job was finished";
  }
  return null;
}

/**
 * What to write. keep_add inserts only. override deletes this job's rows, then inserts.
 * Nothing here updates an existing row.
 */
export function scheduleWritePlan(existing: ExistingVisit[], incoming: VisitInput[], mode: ApplyMode | null): { error: string | null; insert: VisitInput[]; deleteIds: string[] } {
  const shape = validateVisits(incoming, "9999-12-31");
  if (shape) return { error: shape, insert: [], deleteIds: [] };
  if (!existing.length) return { error: null, insert: incoming, deleteIds: [] };
  if (mode !== "keep_add" && mode !== "override") {
    return { error: "Choose whether to add these days or replace the bookings on this job", insert: [], deleteIds: [] };
  }
  if (mode === "override") return { error: null, insert: incoming, deleteIds: existing.map((e) => e.id) };
  const clash = incoming.find((v) => existing.some((e) => e.date === v.date));
  if (clash) {
    return { error: `${visitLabel(clash.date, clash.start, clash.end)} is already booked on this job. Add picks another day, or choose Complete override.`, insert: [], deleteIds: [] };
  }
  return { error: null, insert: incoming, deleteIds: [] };
}

/** day_count on the new rows only, so each day is its own calendar tile. Old rows are not rewritten. */
export function newRowDayCount(existingCount: number, insertCount: number): { dayIndex: number[] | null; dayCount: number | null } {
  const total = existingCount + insertCount;
  if (total <= 1) return { dayIndex: null, dayCount: null };
  const start = existingCount + 1;
  return { dayIndex: incomingIndexes(insertCount, start), dayCount: total };
}
function incomingIndexes(n: number, start: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i);
}

export type MaterialKind = "unit" | "material" | "part";
export interface MaterialLine {
  key: string;
  item: string;
  qty: number | null;
  unit: string | null;
  code?: string | null;
  quoteItemId?: string | null;
  stockItemId?: string | null;
  kind: MaterialKind;
}
export interface BookedMaterial {
  id: string;
  source: "used" | "allocation";
  item: string;
  qty: number;
  unit?: string | null;
  drawnQty?: number | null;
  stockItemId?: string | null;
  quoteItemId?: string | null;
  note?: string | null;
  /** Set when a reservation was already drawn (installed). Override leaves those alone. */
  drawnAt?: string | null;
}

const CONSUMABLE_NOTE = "Typical repair consumables: R410 or R32 gas, and similar. Which gas is not on this job.";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

export function materialFact(b: BookedMaterial): string {
  const unit = b.unit ? ` ${b.unit}` : "";
  const tail = b.source === "allocation"
    ? (b.drawnAt ? " · installed" : " · reserved")
    : (b.drawnQty && b.drawnQty > 0 ? ` · drawn ${trimNum(b.drawnQty)}${unit}` : "");
  return `${b.item} · ${trimNum(b.qty)}${unit}${tail}`;
}

export function bookedDiffersFromQuote(quote: MaterialLine[], booked: BookedMaterial[]): boolean {
  if (!booked.length) return false;
  if (booked.length !== quote.length) return true;
  return booked.some((b) => {
    const q = quote.find((l) => sameMaterial(l, b));
    return !q || Number(q.qty) !== Number(b.qty);
  });
}

function asSource(l: { key?: string; id?: string; item?: string; name?: string; code?: string | null; productType?: string | null }, source: SourceLine["source"]): SourceLine {
  return { id: l.key || l.id || "x", name: l.item || l.name || "", code: l.code, productType: l.productType, source };
}

export interface PackRow { item_name?: string | null; item_code?: string | null; quantity?: number | string | null }
export interface PlanItem {
  quote_item_id?: string | null;
  product_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  product?: { product_code?: string | null; product_type?: string | null; short_name?: string | null } | null;
}
export interface PlanStock { id?: string; product_id?: string | null; item?: string | null; stock_unit?: string | null }

/** Quote units and materials. Pack rows keep the job-pack order; plan rows supply the stock item. */
export function quoteLinesFromPackAndPlan(pack: PackRow[], plan: { items?: PlanItem[] | null; stock?: PlanStock[] | null } | null): MaterialLine[] {
  const stockByProduct = new Map<string, PlanStock>();
  for (const s of plan?.stock ?? []) if (s.id && s.product_id) stockByProduct.set(s.product_id, s);
  const planItems = plan?.items ?? [];
  const used = new Set<string>();
  const lines: MaterialLine[] = [];
  const push = (partial: MaterialLine) => lines.push(partial);
  pack.forEach((row, i) => {
    const name = (row.item_name || "").trim();
    if (!name) return;
    const code = (row.item_code || "").trim();
    const planItem = planItems.find((p) => {
      const id = p.quote_item_id || "";
      if (id && used.has(id)) return false;
      const pn = (p.item_name || "").trim().toLowerCase();
      const pc = (p.product?.product_code || "").trim().toLowerCase();
      return (code && pc && pc === code.toLowerCase()) || (pn && pn === name.toLowerCase());
    });
    if (planItem?.quote_item_id) used.add(planItem.quote_item_id);
    const stock = planItem?.product_id ? stockByProduct.get(planItem.product_id) : undefined;
    const kind: MaterialKind = isInstallUnit(asSource({ key: String(i), item: name, code, productType: planItem?.product?.product_type }, "quote")) ? "unit" : "material";
    const qtyN = row.quantity == null || row.quantity === "" ? null : Number(row.quantity);
    push({
      key: planItem?.quote_item_id || `pack-${i}-${code || name}`,
      item: name,
      qty: qtyN != null && Number.isFinite(qtyN) ? qtyN : null,
      unit: stock?.stock_unit || (/\b(copper|pipe|trunking|drain)\b/i.test(`${name} ${code}`) ? "m" : null),
      code: code || null,
      quoteItemId: planItem?.quote_item_id || null,
      stockItemId: stock?.id || null,
      kind,
    });
  });
  for (const p of planItems) {
    if (p.quote_item_id && used.has(p.quote_item_id)) continue;
    const name = (p.item_name || p.product?.short_name || "").trim();
    if (!name) continue;
    const stock = p.product_id ? stockByProduct.get(p.product_id) : undefined;
    const kind: MaterialKind = isInstallUnit(asSource({ key: p.quote_item_id || name, item: name, code: p.product?.product_code, productType: p.product?.product_type }, "quote")) ? "unit" : "material";
    const qtyN = p.quantity == null ? null : Number(p.quantity);
    push({
      key: p.quote_item_id || `plan-${name}`,
      item: name,
      qty: qtyN != null && Number.isFinite(qtyN) ? qtyN : null,
      unit: stock?.stock_unit || null,
      code: p.product?.product_code || null,
      quoteItemId: p.quote_item_id || null,
      stockItemId: stock?.id || null,
      kind,
    });
  }
  return lines;
}

/** Installs open on the quote list. Repairs open on extra parts, or the consumable note when there are none. */
export function startingMaterialLines(kind: CheckKind, quote: MaterialLine[], booked: BookedMaterial[]): { lines: MaterialLine[]; note: string | null } {
  if (kind === "quote_visit") return { lines: [], note: null };
  if (kind === "installation") {
    if (!quote.length) return { lines: [], note: "No materials on this quote" };
    return { lines: quote.map((l) => ({ ...l })), note: null };
  }
  const fromQuote = quote.filter((l) => {
    if (/\blabou?r\b/i.test(l.item)) return false;
    const src = asSource(l, "quote");
    if (isInstallUnit(src) || isInstallMaterial(src)) return false;
    return true;
  });
  const seen = new Set(fromQuote.map((l) => norm(l.item)));
  const fromJob: MaterialLine[] = [];
  for (const b of booked) {
    if (b.source !== "used") continue;
    if (seen.has(norm(b.item))) continue;
    const src = asSource({ id: b.id, item: b.item }, "recorded");
    if (isInstallUnit(src) || isInstallMaterial(src)) continue;
    seen.add(norm(b.item));
    fromJob.push({
      key: `booked-${b.id}`,
      item: b.item,
      qty: b.qty,
      unit: b.unit ?? null,
      stockItemId: b.stockItemId ?? null,
      quoteItemId: b.quoteItemId ?? null,
      kind: "part",
    });
  }
  const lines = [...fromQuote, ...fromJob];
  const namedGas = lines.some((l) => isRefrigerant(asSource(l, "quote")));
  const note = namedGas ? null : CONSUMABLE_NOTE;
  return { lines, note };
}

export function sameMaterial(l: Pick<MaterialLine, "item" | "quoteItemId" | "stockItemId">, b: Pick<BookedMaterial, "item" | "quoteItemId" | "stockItemId">): boolean {
  if (l.quoteItemId && b.quoteItemId && l.quoteItemId === b.quoteItemId) return true;
  if (l.stockItemId && b.stockItemId && l.stockItemId === b.stockItemId) return true;
  return norm(l.item) !== "" && norm(l.item) === norm(b.item);
}

export function positiveLines(lines: MaterialLine[]): MaterialLine[] {
  return lines.filter((l) => l.item.trim() && l.qty != null && Number(l.qty) > 0);
}

/**
 * keep_add inserts lines that are not already booked. override replaces this job's draws
 * and undrawn reservations, then inserts the list. Existing rows are not updated.
 */
export function materialsWritePlan(editor: MaterialLine[], booked: BookedMaterial[], mode: ApplyMode | null): {
  error: string | null;
  insert: MaterialLine[];
  reverseDraws: boolean;
  releaseReservations: boolean;
} {
  const real = positiveLines(editor);
  if (!booked.length) return { error: null, insert: real, reverseDraws: false, releaseReservations: false };
  if (mode !== "keep_add" && mode !== "override") {
    return { error: "Choose whether to add these materials or replace what is booked on this job", insert: [], reverseDraws: false, releaseReservations: false };
  }
  if (mode === "override") return { error: null, insert: real, reverseDraws: true, releaseReservations: true };
  return { error: null, insert: real.filter((l) => !booked.some((b) => sameMaterial(l, b))), reverseDraws: false, releaseReservations: false };
}

/** Pool stock is drawn for materials and parts. Quote units are recorded, not taken out of the materials pool. */
export function lineDrawsStock(l: MaterialLine): boolean {
  return l.kind !== "unit" && !!l.stockItemId && l.qty != null && l.qty > 0;
}

/** A typed item draws stock only when its name is a real stock item. No guessed item is created. */
export function stockMatch(name: string, stock: PlanStock[]): PlanStock | null {
  const n = norm(name);
  if (n.length < 3) return null;
  return (stock ?? []).find((s) => s.id && norm(s.item || "") === n) ?? null;
}
