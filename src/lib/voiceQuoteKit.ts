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
import { scoreProductMatch } from "@/components/catalog/searchSynonyms";

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
