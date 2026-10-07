/**
 * Search tags for supplier_products: descriptive / series / size words derived from existing
 * columns, lowercase, space-separated, deduped. Used by the backfill and by PDF ingestion.
 * Search side: productMatchesTerms — every typed word must match somewhere, ignoring case,
 * hyphens and spaces (so "windfree" matches "Wind-free").
 */

export interface TagSource {
  name?: string | null;
  short_name?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  product_category?: string | null;
  product_type?: string | null;
  model_range?: string | null;
  model?: string | null;
  brand?: string | null;
  product_code?: string | null;
  btu_rating?: number | null;
  capacity_btu?: number | null;
  kw?: number | null;
  inverter?: boolean | null;
  refrigerant_type?: string | null;
  phase?: string | null;
}

const STOP = new Set(["and", "the", "with", "for", "of", "a", "an", "to", "in", "on", "-", "&", "x", "incl", "excl", "vat"]);

/** Phrase rules: if any pattern matches the text, add these tags. */
const PHRASES: Array<[RegExp, string[]]> = [
  [/wind[\s-]*free/i, ["wind-free", "windfree"]],
  [/x[\s-]*treme|extreme/i, ["extreme", "xtreme"]],
  [/(one|1)[\s-]*way/i, ["one-way", "1-way", "1way"]],
  [/(two|2)[\s-]*way/i, ["two-way", "2-way", "2way"]],
  [/(four|4)[\s-]*way/i, ["four-way", "4-way", "4way"]],
  [/mini[\s-]*cassette/i, ["mini", "cassette", "mini-cassette"]],
  [/cassette/i, ["cassette"]],
  [/ducted|duct\b/i, ["ducted", "duct"]],
  [/under[\s-]*ceiling|ceiling[\s-]*floor|floor[\s-]*ceiling|console/i, ["underceiling", "ceiling", "floor"]],
  [/(wall|hi)[\s-]*(mounted|wall)|high[\s-]*wall|split/i, ["wall", "split", "highwall"]],
  [/inverter/i, ["inverter"]],
  [/multi[\s-]*split|multi\b/i, ["multi", "multisplit"]],
  [/heat[\s-]*pump/i, ["heatpump", "heat-pump"]],
  [/r[\s-]*32\b/i, ["r32"]],
  [/r[\s-]*410a?\b/i, ["r410a", "r410"]],
  [/(ar\s*-?\s*\d{4})/i, []], // Samsung series handled below
];

function sizesFor(btu: number): string[] {
  const k = Math.round(btu / 1000);
  return [String(btu), `${k}k`, `${k}000`];
}

export function deriveSearchTags(p: TagSource): string {
  const text = [p.name, p.short_name, p.description, p.category, p.subcategory, p.product_category,
    p.product_type, p.model_range, p.model, p.brand].filter(Boolean).join(" ");
  const tags = new Set<string>();
  const add = (w: string | null | undefined) => {
    const t = (w || "").toLowerCase().trim();
    if (t.length >= 2 && !STOP.has(t)) tags.add(t);
  };

  // Plain words from descriptive columns.
  for (const w of text.toLowerCase().split(/[^a-z0-9.+-]+/)) add(w.replace(/^[-.]+|[-.]+$/g, ""));

  for (const [re, out] of PHRASES) if (re.test(text)) out.forEach(add);

  // Series like Samsung AR6500 / AR 6800.
  for (const m of text.matchAll(/\bar\s*-?\s*(\d{4})\b/gi)) { add(`ar${m[1]}`); add(m[1]); }
  if (p.brand && p.model_range) add(`${p.brand} ${p.model_range}`.toLowerCase().replace(/\s+/g, "-"));

  // BTU sizes from columns and text (9000, 12 000, 12k, 18000btu).
  const btus = new Set<number>();
  for (const b of [p.btu_rating, p.capacity_btu]) if (b && b >= 5000 && b <= 200000) btus.add(Math.round(b));
  for (const m of text.matchAll(/\b(\d{1,3})[\s,]?000\s*(btu)?\b/gi)) {
    const v = Number(m[1]) * 1000; if (v >= 5000 && v <= 200000) btus.add(v);
  }
  for (const m of text.matchAll(/\b(\d{1,3})\s*k\b/gi)) {
    const v = Number(m[1]) * 1000; if (v >= 5000 && v <= 200000) btus.add(v);
  }
  btus.forEach((b) => sizesFor(b).forEach(add));
  if (btus.size) add("btu");

  // kW sizes.
  const kws = new Set<string>();
  if (p.kw && p.kw > 0 && p.kw < 100) kws.add(String(Number(p.kw)));
  for (const m of text.matchAll(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*kw\b/gi)) kws.add(String(Number(m[1].replace(",", "."))));
  kws.forEach((k) => { add(`${k}kw`); add(k); });

  if (p.inverter) add("inverter");
  add(p.refrigerant_type?.replace(/\s|-/g, ""));
  return [...tags].join(" ");
}

/** Lowercase and strip hyphens/spaces so "Wind-free" ≡ "windfree". */
export const squash = (s: string) => s.toLowerCase().replace(/[\s\-_/]+/g, "");

export interface SearchableProduct {
  product_code?: string | null;
  name?: string | null;
  short_name?: string | null;
  brand?: string | null;
  description?: string | null;
  product_category?: string | null;
  btu_rating?: number | null;
  capacity_btu?: number | null;
  kw?: number | null;
  search_tags?: string | null;
}

export function productSearchBlob(p: SearchableProduct): string {
  const raw = [p.product_code, p.name, p.short_name, p.brand, p.description, p.product_category,
    p.btu_rating, p.capacity_btu, p.kw != null ? `${p.kw}kw` : null, p.search_tags].filter((v) => v != null && v !== "").join(" ");
  return `${raw.toLowerCase()} ${squash(raw)}`;
}

/** Every typed word must appear (raw or squashed) in the product blob. */
export function productMatchesTerms(p: SearchableProduct, term: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const blob = productSearchBlob(p);
  return words.every((w) => blob.includes(w) || blob.includes(squash(w)));
}
