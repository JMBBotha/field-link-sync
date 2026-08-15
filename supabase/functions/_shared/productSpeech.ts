/**
 * Turns a raw catalogue row into a natural product description the voice agent
 * can read aloud, e.g. "Samsung 12,000 BTU mid-wall inverter" instead of
 * "AR12TXHQBWKNFA / SAM-AR40-12K-MW".
 *
 * The real product_code and id stay in the payload — only the SPOKEN label
 * changes, so quoting still attaches the exact catalogue item.
 */

import { numberToWords } from "./numberSpeech.ts";

export interface ProductLike {
  brand?: string | null;
  name?: string | null;
  short_name?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  model?: string | null;
  product_code?: string | null;
  btu_rating?: number | null;
  capacity_btu?: number | null;
  kw?: number | null;
  [key: string]: unknown;
}

const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(mid[\s-]?wall|midwall|\bmw\b|hi[\s-]?wall|high[\s-]?wall|wall[\s-]?mount)/i, "mid-wall"],
  [/\b(cassette|4[\s-]?way|cass)\b/i, "cassette"],
  [/\b(ducted|duct)\b/i, "ducted"],
  [/\b(floor[\s-]?standing|floor[\s-]?stand)\b/i, "floor-standing"],
  [/\b(under[\s-]?ceiling|ceiling[\s-]?suspended)\b/i, "under-ceiling"],
  [/\b(multi[\s-]?split)\b/i, "multi-split"],
  [/\b(window\s?wall|window)\b/i, "window"],
  [/\b(portable)\b/i, "portable"],
  [/\b(heat[\s-]?pump)\b/i, "heat pump"],
];

/** Human capacity, e.g. 12000 -> "12,000 BTU" */
function capacityLabel(btu: number | null): string | null {
  if (btu == null || !Number.isFinite(btu)) return null;
  return `${Math.round(btu).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} BTU`;
}

function resolveBtu(p: ProductLike): number | null {
  const direct = typeof p.btu_rating === "number"
    ? p.btu_rating
    : typeof p.capacity_btu === "number"
    ? p.capacity_btu
    : null;
  if (direct && direct >= 3000) return direct;
  if (typeof p.kw === "number" && p.kw > 0) return Math.round(p.kw * 3412);
  const s = `${p.short_name ?? ""} ${p.name ?? ""} ${p.description ?? ""} ${p.product_code ?? ""}`
    .toLowerCase();
  const btuM = s.match(/(\d{4,6})\s*btu/);
  if (btuM) return parseInt(btuM[1], 10);
  const kM = s.match(/\b(\d{1,3})\s*k\b/);
  if (kM && +kM[1] >= 5 && +kM[1] <= 100) return +kM[1] * 1000;
  return null;
}

/** "AR40" style family, useful when the operator asked for it by name. */
export function modelFamily(p: ProductLike): string | null {
  const s = `${p.short_name ?? ""} ${p.model ?? ""} ${p.product_code ?? ""} ${p.name ?? ""}`;
  const m = s.match(/\b([A-Za-z]{2,4}\d{2,3})\b/);
  return m ? m[1].toUpperCase() : null;
}

function productType(p: ProductLike): string | null {
  const s = [p.short_name, p.name, p.description, p.subcategory, p.category]
    .filter(Boolean).join(" ");
  for (const [re, label] of TYPE_PATTERNS) if (re.test(s)) return label;
  return null;
}

function isInverter(p: ProductLike): boolean {
  const s = [p.short_name, p.name, p.description, p.subcategory].filter(Boolean).join(" ");
  return /\b(inverter|inv)\b/i.test(s);
}

/** Fallback label when a row has no capacity/type signal at all. */
function fallbackLabel(p: ProductLike): string {
  const raw = (p.name || p.short_name || p.description || p.product_code || "item") as string;
  return String(raw).replace(/\s{2,}/g, " ").trim();
}

/**
 * Written natural description: "Samsung 12,000 BTU mid-wall inverter".
 * `includeModel` adds the family ("Samsung AR40 12,000 BTU ...") when the
 * operator referred to the model by name.
 */
export function naturalProductName(p: ProductLike, includeModel = false): string {
  const parts: string[] = [];
  const brand = (p.brand ?? "").toString().trim();
  if (brand) parts.push(brand);
  if (includeModel) {
    const fam = modelFamily(p);
    if (fam && (!brand || !fam.toLowerCase().includes(brand.toLowerCase()))) parts.push(fam);
  }
  const cap = capacityLabel(resolveBtu(p));
  if (cap) parts.push(cap);
  const type = productType(p);
  if (type) parts.push(type);
  if (isInverter(p)) parts.push("inverter");

  // Nothing distinctive (consumables, piping, brackets): use the plain name.
  if (!cap && !type) {
    const base = fallbackLabel(p);
    return brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : base;
  }
  return parts.join(" ").replace(/\s{2,}/g, " ").trim();
}

/** Spoken variant: numbers as words — "Samsung twelve thousand BTU mid-wall inverter". */
export function spokenProductName(p: ProductLike, includeModel = false): string {
  const written = naturalProductName(p, includeModel);
  return written.replace(/\b(\d[\d,\s]*\d|\d)\s*BTU\b/gi, (_m, num: string) => {
    const n = parseInt(String(num).replace(/[,\s]/g, ""), 10);
    return Number.isFinite(n) ? `${numberToWords(n)} BTU` : `${num} BTU`;
  });
}

/** Both forms, ready to spread into a tool result row. */
export function productSpeechFields(p: ProductLike, includeModel = false) {
  return {
    display_name: naturalProductName(p, includeModel),
    spoken_name: spokenProductName(p, includeModel),
  };
}
