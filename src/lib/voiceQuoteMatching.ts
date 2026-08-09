import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

/** A single line item spoken by the user, before it is added to the quote. */
export interface VoiceDraftItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  kind: string;
  searchTerms: string;
  spokenPrice: number | null;
  /** Best catalog match, if we found one we are confident about. */
  product: PaletteProduct | null;
  /** 0-1 match confidence against the supplier catalog. */
  confidence: number;
  /** Manual price used when there is no catalog match. */
  manualPrice: number | null;
  /** True until the user resolves a low-confidence / unpriced row. */
  needsReview: boolean;
}

const STOP = new Set(["the", "a", "of", "and", "with", "for", "unit", "units", "install", "installation"]);

const tokenize = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));

/** "3 ton" / "3-ton" / "12000 btu" / "9kw" all normalise into comparable tokens. */
const expand = (tokens: string[]) => {
  const out = new Set(tokens);
  tokens.forEach((t) => {
    const kw = /^(\d+(?:\.\d+)?)kw$/.exec(t);
    if (kw) out.add(kw[1]);
    const btu = /^(\d{4,6})$/.exec(t);
    if (btu) out.add(String(Math.round(Number(btu[1]) / 1000)));
  });
  return [...out];
};

function scoreProduct(terms: string[], product: PaletteProduct): number {
  const haystack = expand(
    tokenize(
      [product.short_name, product.brand, product.product_code, product.description, product.product_category, product.pipe_size]
        .filter(Boolean).join(" "),
    ),
  );
  if (!haystack.length || !terms.length) return 0;
  const set = new Set(haystack);
  let hits = 0;
  terms.forEach((t) => {
    if (set.has(t)) hits += 1;
    else if (haystack.some((h) => h.includes(t) || t.includes(h))) hits += 0.5;
  });
  return hits / terms.length;
}

export function unitPriceOf(product: PaletteProduct): number {
  return Number(product.selling_price) || Number(product.price_per_metre) || Number(product.cost_price) || 0;
}

/**
 * Matches a spoken item against the supplier catalog already loaded in the
 * builder. Anything below the confidence floor is flagged for review instead
 * of being silently priced with a guess.
 */
export function matchToCatalog(
  searchTerms: string,
  products: PaletteProduct[],
  minConfidence = 0.55,
): { product: PaletteProduct | null; confidence: number } {
  const terms = expand(tokenize(searchTerms));
  if (!terms.length || !products.length) return { product: null, confidence: 0 };

  let best: PaletteProduct | null = null;
  let bestScore = 0;
  for (const p of products) {
    const score = scoreProduct(terms, p);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best || bestScore < minConfidence || unitPriceOf(best) <= 0) {
    return { product: null, confidence: bestScore };
  }
  return { product: best, confidence: bestScore };
}

export interface ParsedVoiceItem {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  kind: string;
  search_terms: string;
  spoken_price: number | null;
}

export function toDraftItems(parsed: ParsedVoiceItem[], products: PaletteProduct[]): VoiceDraftItem[] {
  return parsed.map((raw, i) => {
    const { product, confidence } = matchToCatalog(raw.search_terms || raw.name, products);
    const manualPrice = product ? null : raw.spoken_price ?? null;
    return {
      id: `voice-${Date.now()}-${i}`,
      name: raw.name,
      description: raw.description,
      quantity: raw.quantity,
      unit: raw.unit,
      kind: raw.kind,
      searchTerms: raw.search_terms || raw.name,
      spokenPrice: raw.spoken_price ?? null,
      product,
      confidence,
      manualPrice,
      needsReview: !product && !(manualPrice && manualPrice > 0),
    };
  });
}

export const effectivePrice = (item: VoiceDraftItem): number =>
  item.product ? unitPriceOf(item.product) : Number(item.manualPrice) || 0;

export const lineTotal = (item: VoiceDraftItem): number => effectivePrice(item) * (Number(item.quantity) || 0);

/**
 * Builds a synthetic PaletteProduct for a spoken item with no catalog match,
 * so voice items flow through the exact same basket -> quote_items pipeline as
 * catalog items (no separate voice quote schema).
 */
export function draftItemToProduct(item: VoiceDraftItem): PaletteProduct {
  if (item.product) return item.product;
  const price = effectivePrice(item);
  return {
    id: item.id,
    product_code: "VOICE",
    short_name: item.name,
    brand: "",
    product_category: item.kind === "labour" ? "Labour" : "Custom",
    category: item.kind === "labour" ? "Labour" : "Custom",
    cost_excl_vat: price,
    cost_incl_vat: price,
    cost_price: price,
    selling_price: price,
    default_markup_percent: 0,
    description: item.description || item.name,
    is_pinned: false,
    pin_order: null,
    supplier_name: "Manual (voice)",
    supplier_type: "manual",
    price_per_metre: item.unit === "m" ? price : null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: null,
    markup_percent: null,
    unit_type: item.unit,
    price_per_unit_qty: 1,
    price_per_unit_label: item.unit,
  } as PaletteProduct;
}
