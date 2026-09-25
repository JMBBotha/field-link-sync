/**
 * ONE shared spoken-catalog matcher: add_item_to_area, the plan pre-parser /
 * preview and the model chips all go through matchCatalog().
 *
 * Candidates: live supplier_products (archived=false, pdf_upload_id not null)
 * and installation kits/bundles. Fields: name, model code, search_aliases,
 * spoken_name, short_name. Exactly one strong match → use it; otherwise the
 * top 2–3 as chips. Never auto-pick when scores are close.
 */
import { extractBtu } from "@/lib/bundles";

export interface CatalogProductLike {
  id: string;
  product_code?: string | null;
  short_name?: string | null;
  name?: string | null;
  spoken_name?: string | null;
  search_aliases?: string[] | null;
  brand?: string | null;
  description?: string | null;
  btu_rating?: number | null;
  archived?: boolean | null;
  pdf_upload_id?: string | null;
  [k: string]: any;
}
export interface KitLike { id: string; name: string; description?: string | null; min_btu?: number | null; max_btu?: number | null; items?: any[] }

export type CatalogHit =
  | { kind: "product"; id: string; score: number; product: CatalogProductLike }
  | { kind: "kit"; id: string; score: number; kit: KitLike };

export interface CatalogMatch {
  query: string;
  /** Exactly one strong match. */
  pick: CatalogHit | null;
  /** Top 2–3 when not a clear pick (chips). */
  options: CatalogHit[];
  /** All scored hits, best first. */
  ranked: CatalogHit[];
}

export const STRONG_SCORE = 40;
export const CLOSE_GAP = 15;

const NUM_WORDS: Record<string, number> = {
  nine: 9, twelve: 12, eighteen: 18, "twenty four": 24, "twenty-four": 24, thirty: 30,
  "thirty six": 36, "thirty-six": 36, "forty eight": 48, "forty-eight": 48, sixty: 60,
};

/** '12K' | '12 k' | '12000' | '12 000 BTU' | 'twelve thousand' → '12k'; 'inverter' → 'inv'. */
export function normaliseSpokenProduct(q: string): string {
  let s = ` ${String(q || "").toLowerCase()} `;
  for (const [w, n] of Object.entries(NUM_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`\\b${w}\\s*(?:thousand|k)\\b`, "g"), `${n}k`);
  }
  s = s
    .replace(/\b(\d{1,2})[ ,.]?000\b/g, "$1k")
    .replace(/\b(\d{1,2})\s+k\b/g, "$1k")
    .replace(/\bbtu'?s?\b/g, " ")
    .replace(/\binverter\b/g, "inv")
    .replace(/\b(a|an|the|unit|units|aircon|air ?conditioner|one|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

const KIT_INTENT = /\b(piping|pipe|install(?:ation)?)\s+(bundle|kit)s?\b|\bkit\b|\bbundle\b/;
const alnum = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const toks = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const isLiveProduct = (p: CatalogProductLike) =>
  p.archived !== true && !("pdf_upload_id" in p && !p.pdf_upload_id);

function sizeOf(q: string): number | null {
  const m = q.match(/\b(\d{1,2})k\b/);
  return m ? Number(m[1]) : null;
}

function productK(p: CatalogProductLike): number | null {
  const b = extractBtu(p as any);
  return b && b > 0 ? Math.round(b / 1000) : null;
}

export function scoreProduct(q: string, p: CatalogProductLike): number {
  const size = sizeOf(q);
  const words = toks(q).filter((t) => !/^\d{1,2}k$/.test(t));
  const aliases = [...(p.search_aliases || []), p.spoken_name || ""].filter(Boolean).map((a) => a.toLowerCase());
  const blob = new Set(toks([p.short_name, p.name, p.product_code, p.brand, p.description, ...aliases].filter(Boolean).join(" ")));
  const code = alnum(p.product_code);
  let score = 0;
  if (size != null) {
    const k = productK(p);
    if (k == null || k !== size) return 0; // wrong / unknown size never matches a size query
    score += 40;
  }
  if (aliases.some((a) => a === q)) score += 60;
  for (const w of words) {
    const modelish = /\d/.test(w) && /[a-z]/.test(w) && w.length >= 3;
    if (modelish && code.startsWith(w)) score += 60;
    else if (modelish && code.includes(w)) score += 40;
    else if (blob.has(w)) score += 20;
    else if (w.length >= 3 && [...blob].some((b) => b.startsWith(w))) score += 10;
    else score -= 15;
  }
  return score > 0 ? score : 0;
}

function kitK(k: KitLike): number | null {
  const m = [k.name, k.description].filter(Boolean).join(" ").match(/\b0?(\d{1,2})\s*k\b/i);
  return m ? Number(m[1]) : k.min_btu ? Math.round(k.min_btu / 1000) : null;
}

export function matchCatalog(
  query: string,
  products: CatalogProductLike[],
  kits: KitLike[] = [],
  ctx: { areaBtu?: number | null } = {},
): CatalogMatch {
  const q = normaliseSpokenProduct(query);
  let ranked: CatalogHit[];
  if (KIT_INTENT.test(q)) {
    const want = sizeOf(q) ?? (ctx.areaBtu ? Math.round(ctx.areaBtu / 1000) : null);
    const piping = kits.filter((k) => /piping|install/i.test([k.name, k.description].filter(Boolean).join(" ")));
    ranked = piping
      .map((k) => ({ kind: "kit" as const, id: k.id, kit: k, score: want == null ? 20 : kitK(k) === want ? 80 : 0 }))
      .filter((h) => h.score > 0);
  } else {
    ranked = products
      .filter(isLiveProduct)
      .map((p) => ({ kind: "product" as const, id: p.id, product: p, score: scoreProduct(q, p) }))
      .filter((h) => h.score > 0);
  }
  ranked.sort((a, b) => b.score - a.score);
  const [a, b] = ranked;
  const clear = !!a && a.score >= STRONG_SCORE && (!b || a.score - b.score >= CLOSE_GAP);
  return { query: q, pick: clear ? a : null, options: clear ? [] : ranked.slice(0, 3), ranked };
}

const rand = (n: number) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Chip label: name · code · price excl. VAT. */
export function catalogChipLabel(h: CatalogHit, priceExcl?: number | null): string {
  if (h.kind === "kit") return `${h.kit.name}${priceExcl != null ? ` · ${rand(priceExcl)}/m excl. VAT` : ""}`;
  const p = h.product;
  return [p.short_name || p.name, p.product_code, priceExcl != null ? `${rand(priceExcl)} excl. VAT` : null].filter(Boolean).join(" · ");
}
