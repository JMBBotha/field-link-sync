/**
 * voiceQuoteKit — pure logic for the quote-by-voice MVP on /admin/estimates/:id.
 *
 * No React, no Supabase. Turns a transcript into a small set of intents, and
 * turns intents + the live catalog into priced pending lines using the SAME
 * pricing helpers as the click path (getEffectiveUnitPrices / pricing.ts).
 *
 * Quote-kit source of truth (Johan / Professor):
 *  - Copper is sold per metre; pack length lives on the catalog (unit_length).
 *  - 10% waste on copper AND its matching Armaflex: charge_qty = run_m × 1.10.
 *  - Matching insulation is ALWAYS auto-added, never asked.
 *  - Prices come from the catalog only — voice never invents a rand amount.
 */
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { buildProductSearchText, scoreProductMatch, stripSpaces } from "@/components/catalog/searchSynonyms";

/* ────────────────── Kit constants ────────────────── */

export type PipeSize = "1/4" | "3/8" | "1/2" | "5/8" | "3/4";

export const WASTE_FACTOR = 1.1;

/** copper code ↔ matching Armaflex code, keyed by pipe size. */
export const COPPER_KIT: Record<PipeSize, { copper: string; insulation: string; spoken: string }> = {
  "1/4": { copper: "COPRL001", insulation: "IT009", spoken: "quarter inch" },
  "3/8": { copper: "COPRL002", insulation: "IT010", spoken: "three-eighths" },
  "1/2": { copper: "COPRL003", insulation: "IT011", spoken: "half inch" },
  "5/8": { copper: "COPRL004", insulation: "IT012", spoken: "five-eighths" },
  "3/4": { copper: "COPRL005", insulation: "IT013", spoken: "three-quarter" },
};

/** run metres → charged metres (10% waste, rounded to 0.1 m). */
export const chargeQty = (runM: number) => Math.round(runM * WASTE_FACTOR * 10) / 10;

/* ────────────────── Types ────────────────── */

export type VoiceIntent =
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "skip" }
  | { kind: "undo" }
  | { kind: "readback" }
  | { kind: "help" }
  | { kind: "pick"; index: number }
  | { kind: "client"; query: string }
  | { kind: "new_client"; name: string; phone: string | null; address?: string | null }
  | { kind: "phone"; phone: string }
  | { kind: "area"; name: string }
  | { kind: "copper"; runM: number | null; sizes: PipeSize[] }
  | { kind: "labour"; query: string; quantity: number }
  | { kind: "cable"; query: string; quantity: number }
  | { kind: "chase"; quantity: number }
  | { kind: "product"; query: string; quantity: number }
  | { kind: "unknown"; text: string };

export interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  default_price: number | null;
  unit: string | null;
}

/** A priced line waiting for the spoken confirm. */
export interface PendingLine {
  id: string;
  label: string;
  product?: PaletteProduct;
  service?: ServiceRow;
  quantity: number;
  unitLabel: string;
  unitPrice: number;
  unitCost: number;
  markupPct: number;
  /** kit bookkeeping (run metres before waste, paired size…) */
  meta: Record<string, unknown>;
}

/* ────────────────── Text normalisation ────────────────── */

const SMALL: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "five and a half metres" → "5.5 metres", "twenty two" → "22", "two point five" → "2.5". */
export function wordsToNumbers(input: string): string {
  let s = ` ${input.toLowerCase()} `;
  // protect size phrases that contain number words
  s = s
    .replace(/three[\s-]?quarters?/g, " sz34 ")
    .replace(/five[\s-]?eighths?|five[\s-]?eights/g, " sz58 ")
    .replace(/three[\s-]?eighths?|three[\s-]?eights/g, " sz38 ")
    .replace(/quarter[\s-]?inch|quarter/g, " sz14 ")
    .replace(/half[\s-]?inch/g, " sz12 ");
  // "and a half" / "and a quarter" → decimal suffix
  s = s.replace(/(\d+|\b[a-z]+\b) and a half/g, (_m, n) => `${SMALL[n] ?? n}.5`);
  // tens + units ("twenty two")
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_m, t, u) => String(SMALL[t] + SMALL[u]));
  // "two point five"
  s = s.replace(/\b([a-z]+|\d+) point ([a-z]+|\d+)\b/g, (_m, a, b) => `${SMALL[a] ?? a}.${SMALL[b] ?? b}`);
  // bare number words (not "a"/"an" — too noisy)
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (m) => String(SMALL[m]));
  // unicode fractions / spelled fractions
  s = s.replace(/¼/g, " sz14 ").replace(/½/g, " sz12 ").replace(/¾/g, " sz34 ")
    .replace(/\b3\s*\/\s*4\b/g, " sz34 ").replace(/\b5\s*\/\s*8\b/g, " sz58 ").replace(/\b3\s*\/\s*8\b/g, " sz38 ")
    .replace(/\b1\s*\/\s*4\b/g, " sz14 ").replace(/\b1\s*\/\s*2\b/g, " sz12 ")
    // a bare "half" left over after "and a half" handling is a pipe size
    .replace(/\bhalf\b/g, " sz12 ");
  return s.replace(/\s+/g, " ").trim();
}

const SIZE_TOKEN: Record<string, PipeSize> = { sz14: "1/4", sz38: "3/8", sz12: "1/2", sz58: "5/8", sz34: "3/4" };

export function extractSizes(norm: string): PipeSize[] {
  const out: PipeSize[] = [];
  for (const m of norm.matchAll(/\bsz(14|38|12|58|34)\b/g)) {
    const sz = SIZE_TOKEN[`sz${m[1]}`];
    if (sz && !out.includes(sz)) out.push(sz);
  }
  return out;
}

const METRE = /(\d+(?:\.\d+)?)\s*(?:metres?|meters?|mtrs?|mtr|m)\b/;
const QTY_LEAD = /^(?:add|put|give me|i need|we need|and|also|plus)?\s*(?:(\d+(?:\.\d+)?)\s*(?:x|times|of)?\s*)?/;

function metresIn(norm: string): number | null {
  const m = norm.match(METRE);
  return m ? Number(m[1]) : null;
}

function leadingQty(norm: string): number {
  const m = norm.match(QTY_LEAD);
  const n = m?.[1] ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function stripFiller(norm: string, extra: RegExp[] = []): string {
  let s = norm.replace(/\b(add|put|give me|i need|we need|please|the|a|an|of|for|some|and|also|plus|x|times|unit price)\b/g, " ");
  s = s.replace(METRE, " ").replace(/^\s*\d+(?:\.\d+)?\s*/, " ");
  for (const r of extra) s = s.replace(r, " ");
  // put readable sizes back for catalog search
  s = s.replace(/\bsz14\b/g, "1/4").replace(/\bsz38\b/g, "3/8").replace(/\bsz12\b/g, "1/2").replace(/\bsz58\b/g, "5/8").replace(/\bsz34\b/g, "3/4");
  return s.replace(/\s+/g, " ").trim();
}

const PHONE = /(\+?27|0)\s?\d(?:[\s-]?\d){7,9}/;

export function extractPhone(text: string): string | null {
  const m = text.match(PHONE);
  return m ? m[0].replace(/[\s-]/g, "") : null;
}

/* ────────────────── Intent parser ────────────────── */

/**
 * Split a transcript into clauses ("… and …", commas, "then") but keep
 * "quarter and half copper" together — size-only fragments fold into the
 * previous clause.
 */
function clauses(norm: string): string[] {
  const parts = norm.split(/\s*(?:,|;|\bthen\b|\band then\b|\band also\b|\balso\b|\bplus\b|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const sizeOnly = /^(sz\d\d\s*)+(copper|pipe|pipes)?$/.test(p);
    const prev = out[out.length - 1];
    if (sizeOnly && prev) out[out.length - 1] = `${prev} ${p}`;
    else if (prev && /copper|pipe|coo/.test(p) && !/\d/.test(p.replace(/sz\d\d/g, "")) && /sz\d\d/.test(prev) && !/copper|pipe|coo/.test(prev)) {
      // "5 metres quarter and half copper" — noun landed in the 2nd fragment
      out[out.length - 1] = `${prev} ${p}`;
    } else out.push(p);
  }
  return out;
}

export function parseUtterance(text: string): VoiceIntent[] {
  const raw = text.trim();
  if (!raw) return [];
  const norm = wordsToNumbers(raw);

  // ── whole-utterance control words (short turns) ──
  if (/^(yes|yeah|yep|ok|okay|confirm|confirmed|save|save it|go ahead|do it|correct|that's right|thats right|add them|add it)\b[.!]?$/.test(norm)) return [{ kind: "confirm" }];
  if (/^(no|nope|cancel|scrap that|scrap it|clear|start over|forget it|discard)\b[.!]?$/.test(norm)) return [{ kind: "cancel" }];
  if (/^(skip|none|none of those|neither|next)\b[.!]?$/.test(norm)) return [{ kind: "skip" }];
  if (/^(undo|remove last|remove the last one|delete last|take that off)\b/.test(norm)) return [{ kind: "undo" }];
  if (/(read (it |that |them )?back|read the (list|quote)|what have we got|what's on the (list|quote)|whats on the (list|quote)|totals?$|done|that's all|thats all|that's it|thats it|finish|finished)/.test(norm)) return [{ kind: "readback" }];
  if (/^(help|what can i say)\b/.test(norm)) return [{ kind: "help" }];

  const pick = raw.toLowerCase().match(/^(?:number |option |the )?(1|2|3|4|5|one|two|three|four|five|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?: one)?\b[.!]?$/);
  if (pick) {
    const map: Record<string, number> = { one: 1, first: 1, "1st": 1, two: 2, second: 2, "2nd": 2, three: 3, third: 3, "3rd": 3, four: 4, fourth: 4, "4th": 4, five: 5, fifth: 5, "5th": 5 };
    return [{ kind: "pick", index: (map[pick[1]] ?? Number(pick[1])) - 1 }];
  }

  // ── client ──
  const newClient = raw.match(/\b(?:new|add|create)\s+(?:client|customer)\s+(?:called |named )?(.+)$/i);
  if (newClient) {
    // "new client Jane Doe 082 123 4567 at 12 Main Road Bellville"
    let rest = newClient[1];
    let address: string | null = null;
    const addr = rest.match(/\b(?:at|address|living at|staying at)\s+(.+)$/i);
    if (addr && /\d/.test(addr[1])) {
      address = addr[1].replace(/[.?!]$/, "").trim();
      rest = rest.slice(0, addr.index);
    }
    const phone = extractPhone(rest);
    const name = rest.replace(PHONE, "").replace(/\b(phone|number|cell|mobile|is|on)\b/gi, " ").replace(/\s+/g, " ").trim();
    return [{ kind: "new_client", name, phone, address }];
  }
  const client = raw.match(/\b(?:client|customer)\s+(?:is |called |named |for )?(.+)$/i) || raw.match(/^\s*(?:find|look up|lookup|search)\s+(?:client |customer )?(.+)$/i) || raw.match(/^\s*(?:quote |this is )?for\s+(.+)$/i);
  if (client && !/copper|metre|meter|labour|cable|unit/i.test(client[1])) {
    const q = client[1].replace(/[.?!]$/, "").trim();
    return [{ kind: "client", query: q }];
  }
  const phoneOnly = extractPhone(raw);
  if (phoneOnly && raw.replace(PHONE, "").replace(/\b(phone|number|cell|mobile|is|it's|its|the)\b/gi, "").trim().length < 3) {
    return [{ kind: "phone", phone: phoneOnly }];
  }

  // ── area ──
  const area = raw.match(/\b(?:new\s+)?(?:area|section|room)\s+(?:called |named )?(.+)$/i);
  if (area) return [{ kind: "area", name: area[1].replace(/[.?!]$/, "").trim() }];

  // ── line items, one intent per clause ──
  const intents: VoiceIntent[] = [];
  for (const c of clauses(norm)) {
    const sizes = extractSizes(c);
    const metres = metresIn(c);

    if (/\b(copper|coo|coprl\d*|pipe|pipes|piping|tube|tubing|kit)\b/.test(c) || (sizes.length && !/cable|armaflex|insulation|labour|labor/.test(c))) {
      intents.push({ kind: "copper", runM: metres, sizes });
      continue;
    }
    if (/\b(labour|labor|installation|install fee|install cost|fitment|fitting|service call|callout|call out)\b/.test(c)) {
      intents.push({ kind: "labour", query: stripFiller(c, [/\b(labour|labor|install fee|install cost|for)\b/g]), quantity: leadingQty(c) });
      continue;
    }
    if (/\b(chase|chasing|chased)\b/.test(c)) {
      intents.push({ kind: "chase", quantity: metres ?? leadingQty(c) });
      continue;
    }
    if (/\b(cable|wire|wiring|surfix|flex)\b/.test(c)) {
      intents.push({ kind: "cable", query: stripFiller(c), quantity: metres ?? leadingQty(c) });
      continue;
    }
    const q = stripFiller(c);
    if (q.length >= 2) intents.push({ kind: "product", query: q, quantity: metres ?? leadingQty(c) });
    else intents.push({ kind: "unknown", text: c });
  }
  return intents;
}

/* ────────────────── Catalog resolution ────────────────── */

export interface RankedHit<T> { item: T; score: number }

/** Live-catalog search, ranked. Only products already filtered to archived=false + is_active. */
export function rankProducts(query: string, products: PaletteProduct[], limit = 5): RankedHit<PaletteProduct>[] {
  const scored: RankedHit<PaletteProduct>[] = [];
  for (const p of products) {
    const score = scoreProductMatch(query, p);
    if (score >= 0) scored.push({ item: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Decide between "take the top hit" and "ask which one". */
export function decide<T>(hits: RankedHit<T>[]): { pick: T | null; ask: RankedHit<T>[] } {
  if (!hits.length) return { pick: null, ask: [] };
  if (hits.length === 1) return { pick: hits[0].item, ask: [] };
  const [a, b] = hits;
  // exact code / exact alias, clearly ahead of the runner-up
  if (a.score >= 900 && a.score > b.score) return { pick: a.item, ask: [] };
  return { pick: null, ask: hits.slice(0, 3) };
}

export function rankServices(query: string, services: ServiceRow[], limit = 5): RankedHit<ServiceRow>[] {
  const nq = query.toLowerCase().trim();
  const terms = nq.split(/\s+/).filter(Boolean);
  const kw = nq.match(/(\d+(?:\.\d+)?)\s*(?:kw|kilowatt|kilowatts)/)?.[1];
  const scored: RankedHit<ServiceRow>[] = [];
  for (const s of services) {
    const blob = `${s.name} ${s.category || ""}`.toLowerCase();
    let score = -1;
    if (kw && blob.includes(`${kw}kw`)) score = 900;
    else if (nq && blob.includes(nq)) score = 600;
    else {
      const hits = terms.filter((t) => t.length > 1 && blob.includes(t)).length;
      if (hits > 0) score = 100 * hits;
    }
    // bare "labour"/"installation" — surface the installation services
    if (score < 0 && (!terms.length || /^(labour|labor|installation|install)$/.test(nq)) && /install/.test(blob)) score = 50;
    if (score >= 0) scored.push({ item: s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit);
}

export const byCode = (products: PaletteProduct[], code: string) =>
  products.find((p) => (p.product_code || "").trim().toUpperCase() === code.toUpperCase()) ?? null;

/* ────────────────── Pending-line builders ────────────────── */

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function productLine(p: PaletteProduct, quantity: number, meta: Record<string, unknown> = {}): PendingLine {
  const { unitCost, unitSell } = getEffectiveUnitPrices(p);
  const perMetre = !!(p.sold_in_length && p.price_per_metre);
  return {
    id: uid(),
    label: p.short_name || p.product_code,
    product: p,
    quantity: Math.round(quantity * 100) / 100,
    unitLabel: perMetre ? "m" : (p.price_per_unit_label || "each"),
    unitPrice: Math.round(unitSell * 100) / 100,
    unitCost: Math.round(unitCost * 100) / 100,
    markupPct: p.default_markup_percent ?? p.markup_percent ?? 35,
    meta: { voice: true, ...meta },
  };
}

export function serviceLine(s: ServiceRow, quantity: number): PendingLine {
  return {
    id: uid(),
    label: s.name,
    service: s,
    quantity,
    unitLabel: s.unit || "each",
    unitPrice: Number(s.default_price || 0),
    unitCost: 0,
    markupPct: 0,
    meta: { voice: true },
  };
}

/**
 * Copper kit for one size: copper + its Armaflex, both at run_m × 1.10.
 * Returns the lines plus any codes missing from the live catalog (never invented).
 */
export function buildCopperKit(size: PipeSize, runM: number, products: PaletteProduct[]): { lines: PendingLine[]; missing: string[] } {
  const spec = COPPER_KIT[size];
  const qty = chargeQty(runM);
  const lines: PendingLine[] = [];
  const missing: string[] = [];
  const copper = byCode(products, spec.copper);
  const insulation = byCode(products, spec.insulation);
  const meta = { kit: "copper", pipe_size: size, run_m: runM, waste_factor: WASTE_FACTOR };
  if (copper) lines.push(productLine(copper, qty, meta)); else missing.push(spec.copper);
  if (insulation) lines.push(productLine(insulation, qty, { ...meta, paired_with: spec.copper })); else missing.push(spec.insulation);
  return { lines, missing };
}

/* ────────────────── Read-back ────────────────── */

export const rand = (n: number) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const lineTotal = (l: PendingLine) => Math.round(l.quantity * l.unitPrice * 100) / 100;

export function pendingSubtotal(lines: PendingLine[]) {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
}

export function readBackText(lines: PendingLine[], vatRate: number): string {
  if (!lines.length) return "Nothing on the list yet.";
  const parts = lines.map((l, i) => `${i + 1}. ${l.quantity} ${l.unitLabel} ${l.label} at ${rand(l.unitPrice)}, ${rand(lineTotal(l))}`);
  const sub = pendingSubtotal(lines);
  const incl = Math.round(sub * (1 + vatRate) * 100) / 100;
  return `${parts.join(". ")}. Subtotal ${rand(sub)} excluding VAT, ${rand(incl)} including VAT. Say confirm to save to the quote, or cancel.`;
}

/* ══════════════════════════════════════════════════════════════════════
 * Scene (batch) parsing — Johan UX pivot.
 *
 * One spoken/pasted scene → grouped-by-area breakdown, priced from the live
 * catalog, with NO questions asked. Ambiguity / gaps are flagged on the row
 * (candidates, hints) so the breakdown card can offer chips instead of a quiz.
 * ══════════════════════════════════════════════════════════════════════ */

export type SceneLineStatus = "ok" | "ambiguous" | "incomplete" | "missing";

export interface SceneLine extends PendingLine {
  status: SceneLineStatus;
  /** what to fix / why it is flagged — shown on the row */
  hint?: string;
  /** alternate catalog picks when the match is not clear-cut */
  productCandidates?: PaletteProduct[];
  serviceCandidates?: ServiceRow[];
  /** the spoken fragment this row came from */
  spoken: string;
}

export interface SceneArea {
  key: string;
  name: string;
  lines: SceneLine[];
  /** install context ("back-to-back", "outside wall") */
  notes: string[];
  /** fragments nothing could be made of */
  unparsed: string[];
}

export interface SceneBreakdown {
  transcript: string;
  areas: SceneArea[];
}

/* ───────── slots (what an area accumulates before catalog resolution) ───────── */

export interface UnitSpec { btu: number | null; brand: string | null; model: string | null; descriptors: string[]; spoken: string[] }
export interface CopperSpec { sizes: PipeSize[]; runM: number | null; spoken: string[] }

export type SceneSlot =
  | { t: "unit"; u: UnitSpec }
  | { t: "copper"; c: CopperSpec }
  | { t: "labour"; hours: number | null; query: string; spoken: string }
  | { t: "drain"; metres: number | null; spoken: string }
  | { t: "elbows"; qty: number; spoken: string }
  | { t: "chase"; qty: number; spoken: string }
  | { t: "cable"; query: string; qty: number; spoken: string }
  | { t: "product"; query: string; qty: number; spoken: string }
  | { t: "note"; text: string }
  | { t: "unknown"; text: string };

export interface SceneDraftArea { name: string; slots: SceneSlot[] }
export interface SceneDraft { areas: SceneDraftArea[] }

/* ───────── vocab ───────── */

const ROOM_WORDS =
  "bedroom|lounge|living room|tv room|family room|kitchen|dining room|dining|study|office|garage|patio|bathroom|guest room|kids room|kid's room|boardroom|board room|reception|server room|entrance|hallway|hall|passage|braai room|scullery|laundry|playroom|nursery|granny flat|cottage|workshop|store room|storeroom|conference room|classroom|ward|surgery|consulting room|waiting room|gym|studio|loft|attic|basement|foyer|pantry|balcony|veranda|stoep|en suite|ensuite|showroom|warehouse|canteen|staff room|open plan|room";
const AREA_CUE = new RegExp(
  `^(?:(?:and|then|next|now|in|for|the|okay|ok|so|moving on to|moving to|on to|next is|next up)\\s+)*` +
    `((?:main|master|master's|spare|guest|second|third|first|front|back|upstairs|downstairs|open plan|small|big|large|kids|children's|baby|boy's|girl's|top|bottom|left|right|north|south|east|west)\\s+)?` +
    `(${ROOM_WORDS})(?:\\s+(\\d{1,2}(?!\\d)|[a-d](?=\\s|$)))?\\b`,
  "i",
);
const EXPLICIT_AREA = /^(?:new\s+)?(?:area|section|zone)\s+(?:called |named )?([a-z0-9 '\-]+?)\s*$/i;

const BRANDS = /\b(samsung|lg|daikin|midea|alliance|carrier|gree|hisense|jet[\s-]?air|jetair|mitsubishi|panasonic|york|fujitsu|toshiba|defy|aux|tcl|haier|whirlpool|kelvinator|goodman|sinclair|trane|lennox)\b/;
const DESCRIPTORS = /\b(inverter|non[\s-]?inverter|fixed speed|fixed|cassette|ducted|mid ?wall|wall split|hi ?wall|high wall|floor standing|under ceiling|console|window unit|portable|wind ?free|heat pump)\b/g;
const MODEL = /\b(?!sz\d)(?!(?:the|is|and|for|of|at|to|in|on|kw|btu|x|so|it|its|a|an|we|i|by|or|up|as|be|do|if|my|us|unit|units|room|area|about|split|type|model|number|no|size|with|plus|only|need|needs)\b)([a-z]{1,5})[\s-]?(\d{2,5})([a-z0-9/-]*)\b/;
const INSTALL_CONTEXT = /\b(back[\s-]?to[\s-]?back|outside wall|through the wall|on the roof|roof mount(?:ed)?|wall bracket(?:s)?|floor stand|high wall|long run|ceiling void|in the ceiling|on brackets)\b/;
const HOURS = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/;
const ELBOWS = /(\d+(?:\.\d+)?)?\s*(?:x\s*)?(?:pvc\s+)?(?:drain\s+)?elbows?\b/;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** thousands + "eighteen thousand" + approximations → plain numbers. */
export function normalizeScene(text: string): string {
  let s = text.replace(/(\d)[,\s](\d{3})(?!\d)/g, "$1$2");
  s = wordsToNumbers(s);
  s = s.replace(/\b(\d+)\s*thousand\b/g, (_m, n) => String(Number(n) * 1000));
  s = s.replace(/\b(approximately|approx|about|roughly|around|more or less|plus minus|say)\b/g, " ");
  s = s.replace(/\b(sz\d\d)\s+(?:and|plus|&|with)\s+(sz\d\d)\b/g, "$1 $2");
  s = s.replace(/\.(?!\d)/g, " , ").replace(/[!?]/g, " , ");
  return s.replace(/\s+/g, " ").trim();
}

/* ───────── clause → slots ───────── */

function parseSceneClause(c: string): SceneSlot[] {
  const out: SceneSlot[] = [];
  let s = ` ${c} `;

  // install context — notes, not lines ("outside wall so back-to-back installation")
  const ctxRe = new RegExp(INSTALL_CONTEXT.source, "g");
  const ctxs = Array.from(s.matchAll(ctxRe));
  if (ctxs.length) {
    for (const m of ctxs) out.push({ t: "note", text: m[1].replace(/\s+/g, " ").replace(/back[\s-]to[\s-]back/, "back-to-back") });
    s = s.replace(ctxRe, " ");
    const leftover = s.replace(/\b(so|an|a|the|installation|install|type|it|its|it's|is|unit|needed|required|we|need|will|be|do|then|it'll|that's|thats|on|with|and)\b/g, " ").replace(/\s+/g, " ").trim();
    if (leftover.length < 2) return out;
  }

  // elbows can ride along with the drain clause
  if (/\belbows?\b/.test(s)) {
    const el = s.match(ELBOWS)!;
    out.push({ t: "elbows", qty: el[1] ? Number(el[1]) : 1, spoken: el[0].trim() });
    s = s.replace(el[0], " ");
    if (s.replace(/\b(with|and|plus)\b/g, " ").trim().length < 2) return out;
  }

  if (/\b(drain|drainage|condensate)\b/.test(s) && !/\bpump\b/.test(s)) {
    out.push({ t: "drain", metres: metresIn(s), spoken: s.trim() });
    return out;
  }

  // unit (AC equipment)
  let btu: number | null = null;
  const btuM = s.match(/(\d+(?:\.\d+)?)\s*(?:k\s*)?btus?\b/);
  if (btuM) btu = Number(btuM[1]) < 100 ? Number(btuM[1]) * 1000 : Number(btuM[1]);
  else {
    const kM = s.match(/\b(\d{1,2})\s*k\b(?!\s*w)/) || s.match(/\b(9|12|18|24|30|36|48|60)000\b/);
    if (kM) btu = Number(kM[1]) * 1000;
    else {
      const kw = s.match(/(\d+(?:\.\d+)?)\s*(?:kw|kilowatts?)\b/);
      // catalog names its splits by the kW-looking BTU class ("18kW" ↔ 18 000 BTU)
      if (kw && !/\b(labour|labor|cable|wire)\b/.test(s)) btu = Math.round(Number(kw[1])) * 1000;
    }
  }
  const brand = s.match(BRANDS)?.[1]?.replace(/\s|-/g, "") ?? null;
  const descriptors = Array.from(s.matchAll(DESCRIPTORS)).map((m) => m[1]);
  const looksLikeLine = /\b(copper|coo|coprl\d*|pipe|piping|tube|cable|wire|labour|labor|chase|elbow|bracket|pump|breaker|isolator)\b/.test(s);
  const modelM = !looksLikeLine ? s.replace(BRANDS, " ").replace(/\d+\s*(?:k\s*)?btus?\b/g, " ").match(MODEL) : null;
  const model = modelM ? `${modelM[1]}${modelM[2]}${modelM[3]}`.toUpperCase() : null;
  const unitWords = /\b(aircon|air con|air conditioner|split unit|split|unit|indoor|outdoor)\b/.test(s);

  if (btu || brand || (model && !looksLikeLine) || (unitWords && descriptors.length)) {
    if (!looksLikeLine || btu) {
      out.push({ t: "unit", u: { btu, brand, model, descriptors, spoken: [c.trim()] } });
      if (!looksLikeLine && !/\b(labour|labor|install)/.test(s)) return out;
      // "12000 btu installation" → unit + labour below
    }
  }

  const sizes = extractSizes(s);
  const metres = metresIn(s);

  if (/\b(copper|coo|coprl\d*|pipe|pipes|piping|tube|tubing|kit|lagging|armaflex|insulation)\b/.test(s) || (sizes.length && !/cable|labour|labor/.test(s))) {
    out.push({ t: "copper", c: { sizes, runM: metres, spoken: [c.trim()] } });
    return out;
  }
  if (/\b(labour|labor|install(?:ation)?(?: fee| cost)?|man hours|fitment|fitting|service call|callout|call out)\b/.test(s)) {
    const hours = s.match(HOURS)?.[1];
    out.push({
      t: "labour",
      hours: hours ? Number(hours) : null,
      query: stripFiller(s, [/\b(labour|labor|install fee|install cost|hours?|hrs?|for|man)\b/g, HOURS]),
      spoken: c.trim(),
    });
    return out;
  }
  if (/\b(chase|chasing|chased)\b/.test(s)) {
    out.push({ t: "chase", qty: metres ?? leadingQty(s.trim()), spoken: c.trim() });
    return out;
  }
  if (/\b(cable|wire|wiring|surfix|flex)\b/.test(s)) {
    out.push({ t: "cable", query: stripFiller(s), qty: metres ?? leadingQty(s.trim()), spoken: c.trim() });
    return out;
  }
  if (out.length) return out; // unit already captured; nothing else here
  const q = stripFiller(s);
  if (q.length >= 2) out.push({ t: "product", query: q, qty: metres ?? leadingQty(s.trim()), spoken: c.trim() });
  else out.push({ t: "unknown", text: c.trim() });
  return out;
}

/* ───────── scene → areas of slots (pure, offline) ───────── */

export function parseScene(text: string, fallbackAreaName = "Items"): SceneDraft {
  const norm = normalizeScene(text);
  if (!norm) return { areas: [] };
  const draft: SceneDraft = { areas: [] };
  let cur: SceneDraftArea | null = null;
  const areaFor = () => {
    if (!cur) { cur = { name: fallbackAreaName, slots: [] }; draft.areas.push(cur); }
    return cur;
  };

  const push = (slot: SceneSlot) => {
    const a = areaFor();
    // merge unit fragments ("18000 btu" + "ar 4500 samsung") into one unit
    if (slot.t === "unit") {
      const prev = [...a.slots].reverse().find((x): x is Extract<SceneSlot, { t: "unit" }> => x.t === "unit");
      if (prev && !(prev.u.btu && slot.u.btu) && !(prev.u.brand && slot.u.brand && prev.u.brand !== slot.u.brand)) {
        prev.u.btu = prev.u.btu ?? slot.u.btu;
        prev.u.brand = prev.u.brand ?? slot.u.brand;
        prev.u.model = prev.u.model ?? slot.u.model;
        prev.u.descriptors = Array.from(new Set([...prev.u.descriptors, ...slot.u.descriptors]));
        prev.u.spoken.push(...slot.u.spoken);
        return;
      }
    }
    // merge copper fragments ("3 metres of piping" + "piping is 1/4 1/2")
    if (slot.t === "copper") {
      const prev = [...a.slots].reverse().find((x): x is Extract<SceneSlot, { t: "copper" }> => x.t === "copper");
      const complete = !!(prev && prev.c.sizes.length && prev.c.runM != null);
      if (prev && !(complete && slot.c.runM != null && slot.c.sizes.length)) {
        prev.c.runM = prev.c.runM ?? slot.c.runM;
        for (const sz of slot.c.sizes) if (!prev.c.sizes.includes(sz)) prev.c.sizes.push(sz);
        prev.c.spoken.push(...slot.c.spoken);
        return;
      }
    }
    a.slots.push(slot);
  };

  for (const clause of clauses(norm)) {
    let body = clause;
    const explicit = body.match(EXPLICIT_AREA);
    if (explicit) {
      cur = { name: cap(explicit[1].trim()), slots: [] };
      draft.areas.push(cur);
      continue;
    }
    const cue = body.match(AREA_CUE);
    if (cue) {
      const name = cap([cue[1]?.trim(), cue[2], cue[3]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      const rest = body.slice(cue[0].length).replace(/^\s*(?:is|has|gets|needs|we need|with|:|-)\s*/, "").trim();
      const existing = draft.areas.find((a) => a.name.toLowerCase() === name.toLowerCase());
      cur = existing ?? { name, slots: [] };
      if (!existing) draft.areas.push(cur);
      if (!rest) continue;
      body = rest;
    }
    for (const slot of parseSceneClause(body)) push(slot);
  }
  return draft;
}

/* ───────── catalog resolution ───────── */

const uidS = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function stubLine(label: string, spoken: string, status: SceneLineStatus, hint: string, meta: Record<string, unknown> = {}, quantity = 1, unitLabel = "each"): SceneLine {
  return { id: uidS(), label, quantity, unitLabel, unitPrice: 0, unitCost: 0, markupPct: 0, meta: { voice: true, ...meta }, status, hint, spoken };
}

const asScene = (l: PendingLine, spoken: string, status: SceneLineStatus = "ok", extra: Partial<SceneLine> = {}): SceneLine =>
  ({ ...l, status, spoken, ...extra });

const isEquipment = (p: PaletteProduct, blob: string) =>
  !!p.btu_rating || /\b(split|inverter|midwall|mid wall|cassette|ducted|aircon|air con|btu|wall mounted|window unit|console)\b/.test(blob);

/** Rank AC units for a spoken spec: brand + BTU class + model fragment (aliases/code). Never invents. */
export function rankUnits(u: UnitSpec, products: PaletteProduct[], limit = 6): RankedHit<PaletteProduct>[] {
  if (!u.btu && !u.brand && !u.model) return [];
  const brand = u.brand?.toLowerCase() ?? null;
  const modelS = stripSpaces(u.model || "");
  const out: RankedHit<PaletteProduct>[] = [];
  for (const p of products) {
    const blob = buildProductSearchText(p);
    if (!isEquipment(p, blob)) continue;
    let score = 0;
    if (brand) {
      const pBrand = `${p.brand || ""} ${p.supplier_name || ""}`.toLowerCase().replace(/[\s-]/g, "");
      if (pBrand.includes(brand) || blob.replace(/[\s-]/g, "").includes(brand)) score += 300;
      else continue;
    }
    if (u.btu) {
      const k = u.btu / 1000;
      const pb = p.btu_rating ? Number(p.btu_rating) : null;
      const nameHit = new RegExp(`\\b${k}k\\b|\\b${u.btu}\\b|\\b${k}\\s*000\\b`).test(blob);
      if (pb === u.btu || nameHit) score += 500;
      else if (pb || /\b\d{1,2}k\b/.test(blob)) continue; // a different size
    }
    if (modelS) {
      const s = scoreProductMatch(u.model!, p);
      if (s >= 900) score += 700;
      else if (s >= 700) score += 450;
      else {
        const codeS = stripSpaces(p.product_code || "");
        if (codeS.includes(modelS)) score += 500;
        else if (modelS.length >= 3 && codeS.startsWith(modelS.slice(0, 3))) score += 150; // "ar4500" ↔ "AR40F…"
      }
    }
    for (const d of u.descriptors) if (blob.includes(d.replace(/\s|-/g, "")) || blob.includes(d)) score += 80;
    if (score <= 0) continue;
    out.push({ item: p, score });
  }
  out.sort((a, b) => b.score - a.score || (a.item.short_name || "").localeCompare(b.item.short_name || ""));
  return out.slice(0, limit);
}

const unitLabelFor = (u: UnitSpec) =>
  [u.brand ? cap(u.brand) : null, u.model, u.btu ? `${u.btu / 1000}K BTU` : null, ...u.descriptors].filter(Boolean).join(" ") || "AC unit";

/** Resolve a draft (or transcript) into a priced, grouped breakdown. Pure; asks nothing. */
export function buildSceneBreakdown(
  transcript: string,
  products: PaletteProduct[],
  services: ServiceRow[],
  opts: { fallbackAreaName?: string } = {},
): SceneBreakdown {
  const draft = parseScene(transcript, opts.fallbackAreaName ?? "Items");
  const areas: SceneArea[] = [];

  for (const da of draft.areas) {
    const area: SceneArea = { key: uidS(), name: da.name, lines: [], notes: [], unparsed: [] };
    const unit = da.slots.find((s): s is Extract<SceneSlot, { t: "unit" }> => s.t === "unit");
    const areaBtu = unit?.u.btu ?? null;
    for (const s of da.slots) if (s.t === "note") area.notes.push(s.text);
    const contextNote = area.notes.join(", ");

    for (const s of da.slots) {
      switch (s.t) {
        case "note":
          break;
        case "unknown":
          area.unparsed.push(s.text);
          break;
        case "unit": {
          const hits = rankUnits(s.u, products);
          const spoken = s.u.spoken.join(" / ");
          const meta = { unit: true, btu: s.u.btu, spoken_brand: s.u.brand, spoken_model: s.u.model };
          if (!hits.length) {
            area.lines.push(stubLine(unitLabelFor(s.u), spoken, "missing", "No matching unit in the live catalog — pick one from the add bar.", meta));
            break;
          }
          const [a, b] = hits;
          const clear = hits.length === 1 || a.score >= b.score + 250;
          area.lines.push(asScene(productLine(a.item, 1, meta), spoken, clear ? "ok" : "ambiguous", {
            hint: clear ? undefined : `Closest matches for “${unitLabelFor(s.u)}” — tap to switch.`,
            productCandidates: hits.slice(0, 4).map((h) => h.item),
          }));
          break;
        }
        case "copper": {
          const spoken = s.c.spoken.join(" / ");
          if (!s.c.sizes.length || s.c.runM == null) {
            const hint = !s.c.sizes.length && s.c.runM == null ? "Pipe size and run metres needed."
              : !s.c.sizes.length ? `${s.c.runM} m spoken — which pipe size?` : `${s.c.sizes.join(" + ")} spoken — how many metres?`;
            area.lines.push(stubLine("Copper kit (copper + Armaflex)", spoken, "incomplete", hint, { kit_pending: { sizes: s.c.sizes, runM: s.c.runM } }, s.c.runM ?? 0, "m"));
            break;
          }
          for (const sz of s.c.sizes) {
            const kit = buildCopperKit(sz, s.c.runM, products);
            kit.lines.forEach((l) => area.lines.push(asScene(l, spoken)));
            for (const code of kit.missing) {
              area.lines.push(stubLine(`${code} (${COPPER_KIT[sz].spoken}${code.startsWith("IT") ? " Armaflex" : " copper"})`, spoken, "missing", `${code} is not in the live catalog — add it there first.`, { kit: "copper", pipe_size: sz, missing_code: code }, chargeQty(s.c.runM), "m"));
            }
          }
          break;
        }
        case "drain": {
          const hits = rankProducts("drain pipe", products);
          const d = decide(hits);
          const p = d.pick ?? d.ask[0]?.item ?? null;
          if (!p) { area.lines.push(stubLine("Drain pipe", s.spoken, "missing", "No drain pipe in the live catalog.", { drain: true }, s.metres ?? 1, "m")); break; }
          const l = productLine(p, s.metres ?? 1, { drain: true });
          area.lines.push(asScene(l, s.spoken, s.metres == null ? "incomplete" : d.pick ? "ok" : "ambiguous", {
            hint: s.metres == null ? "How many metres of drain?" : d.pick ? undefined : "Closest drain matches — tap to switch.",
            productCandidates: d.pick ? undefined : d.ask.map((h) => h.item),
          }));
          break;
        }
        case "elbows": {
          const hits = rankProducts("drain elbow", products);
          const d = decide(hits);
          const p = d.pick ?? d.ask[0]?.item ?? null;
          if (!p) { area.lines.push(stubLine("Drain elbows", s.spoken, "missing", "No elbow in the live catalog.", { elbows: true }, s.qty)); break; }
          area.lines.push(asScene(productLine(p, s.qty, { elbows: true }), s.spoken, d.pick ? "ok" : "ambiguous", {
            hint: d.pick ? undefined : "Closest elbow matches — tap to switch.",
            productCandidates: d.pick ? undefined : d.ask.map((h) => h.item),
          }));
          break;
        }
        case "labour": {
          const q = areaBtu ? `install ${areaBtu / 1000} kw` : (s.query || "installation");
          let hits = rankServices(q, services);
          if (!hits.length && areaBtu) hits = rankServices("installation", services);
          const d = decide(hits);
          const meta = { labour: true, hours: s.hours, install_context: contextNote || null, line_note: [s.hours ? `≈${s.hours} h` : null, contextNote || null].filter(Boolean).join(" · ") || null };
          if (!hits.length) { area.lines.push(stubLine(`Labour${s.hours ? ` ≈${s.hours} h` : ""}`, s.spoken, "missing", "No matching labour service in Services.", meta)); break; }
          const svc = d.pick ?? hits[0].item;
          area.lines.push(asScene(serviceLine(svc, 1), s.spoken, d.pick ? "ok" : "ambiguous", {
            meta: { voice: true, ...meta },
            hint: d.pick ? (s.hours ? `Fixed install rate; ≈${s.hours} h noted on the line.` : undefined) : "Which installation service?",
            serviceCandidates: d.pick ? undefined : hits.slice(0, 4).map((h) => h.item),
          }));
          break;
        }
        case "chase": {
          const sHits = rankServices("chase", services);
          const pHits = rankProducts("chase", products);
          if (sHits.length) area.lines.push(asScene(serviceLine(sHits[0].item, s.qty), s.spoken));
          else if (pHits.length) area.lines.push(asScene(productLine(pHits[0].item, s.qty), s.spoken));
          else area.lines.push(stubLine("Chasing", s.spoken, "missing", "No chasing item in the live catalog or Services.", { chase: true }, s.qty, "m"));
          break;
        }
        case "cable":
        case "product": {
          const query = s.t === "cable" ? (s.query || "cable") : s.query;
          const hits = rankProducts(query, products);
          const d = decide(hits);
          if (d.pick) { area.lines.push(asScene(productLine(d.pick, s.qty), s.spoken)); break; }
          if (!d.ask.length) { area.lines.push(stubLine(cap(query), s.spoken, "missing", `Nothing in the live catalog for “${query}”.`, {}, s.qty)); break; }
          area.lines.push(asScene(productLine(d.ask[0].item, s.qty), s.spoken, "ambiguous", {
            hint: `Closest matches for “${query}” — tap to switch.`,
            productCandidates: d.ask.map((h) => h.item),
          }));
          break;
        }
      }
    }
    // labour last, unit first — the way Johan reads a quote
    const rank = (l: SceneLine) => (l.meta.unit ? 0 : l.meta.labour ? 9 : 5);
    area.lines.sort((a, b) => rank(a) - rank(b));
    areas.push(area);
  }
  return { transcript, areas };
}

/* ───────── card edits (pure) ───────── */

export const isSaveable = (l: SceneLine) => (l.status === "ok" || l.status === "ambiguous") && !!(l.product || l.service);

export function swapLineProduct(line: SceneLine, p: PaletteProduct): SceneLine {
  const l = productLine(p, line.quantity || 1, line.meta);
  return { ...l, id: line.id, status: "ok", hint: undefined, productCandidates: line.productCandidates, spoken: line.spoken };
}

export function swapLineService(line: SceneLine, s: ServiceRow): SceneLine {
  const l = serviceLine(s, line.quantity || 1);
  return { ...l, id: line.id, meta: { ...l.meta, ...line.meta }, status: "ok", hint: undefined, serviceCandidates: line.serviceCandidates, spoken: line.spoken };
}

/** Turn an incomplete copper row into real kit lines once size(s) + metres are known. */
export function resolveKitPending(line: SceneLine, sizes: PipeSize[], runM: number, products: PaletteProduct[]): SceneLine[] {
  const out: SceneLine[] = [];
  for (const sz of sizes) {
    const kit = buildCopperKit(sz, runM, products);
    kit.lines.forEach((l) => out.push(asScene(l, line.spoken)));
    for (const code of kit.missing) out.push(stubLine(`${code} (${COPPER_KIT[sz].spoken})`, line.spoken, "missing", `${code} is not in the live catalog.`, { kit: "copper", pipe_size: sz, missing_code: code }, chargeQty(runM), "m"));
  }
  return out;
}

export function sceneSubtotal(bd: SceneBreakdown) {
  return Math.round(bd.areas.flatMap((a) => a.lines).filter(isSaveable).reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
}

export function sceneReadBack(bd: SceneBreakdown, vatRate: number): string {
  const saveable = bd.areas.filter((a) => a.lines.some(isSaveable));
  if (!saveable.length) return "Nothing priced yet.";
  const parts = saveable.map((a) => `${a.name}: ${a.lines.filter(isSaveable).map((l) => `${l.quantity} ${l.unitLabel} ${l.label} ${rand(lineTotal(l))}`).join(", ")}`);
  const sub = sceneSubtotal(bd);
  const incl = Math.round(sub * (1 + vatRate) * 100) / 100;
  return `${parts.join(". ")}. Subtotal ${rand(sub)} excluding VAT, ${rand(incl)} including. Tap Confirm to save to the quote.`;
}
