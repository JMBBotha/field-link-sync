import { isAcUnitLine } from "@/lib/lineDisplay";

/** Quote "units in this quote" cards (Johan 13 Oct 08:32). Pure helpers; no I/O. */

export type FeatureHighlight = {
  /** Icon key: windfree | ai | fast | protect | inverter | filter | wifi | quiet */
  icon?: string | null;
  title: string;
  text: string;
  image_url?: string | null;
};

export interface ProductMedia {
  id?: string;
  model_key: string;
  model_code: string;
  brand?: string | null;
  family?: string | null;
  display_name?: string | null;
  subtitle?: string | null;
  image_url?: string | null;
  image_status?: "ready" | "needs_cutout" | "none" | null;
  product_url?: string | null;
  support_url?: string | null;
  source_label?: string | null;
  bullets?: string[] | null;
  specs?: Record<string, any> | null;
  feature_highlight?: FeatureHighlight | null;
  status?: "draft" | "approved" | "failed" | null;
}

export interface UnitCardLine {
  item_name?: string | null;
  item_type?: string | null;
  item_number?: string | null;
  product_code?: string | null;
  is_bundle?: boolean | null;
  metadata?: Record<string, any> | null;
  quantity?: number | string | null;
  area_name?: string | null;
  brand?: string | null;
  category?: string | null;
  btu_rating?: number | null;
  capacity_btu?: number | null;
  kw?: number | null;
  refrigerant_type?: string | null;
}

export interface UnitCard {
  modelKey: string;
  modelCode: string;
  quantity: number;
  rooms: string[];
  /** Approved content, or null => fallback card (brand + outline + catalogue BTU/refrigerant). */
  media: ProductMedia | null;
  brand: string | null;
  btu: number | null;
  refrigerant: string | null;
  name: string;
}

/** Same rule as public.normalize_model_code(): upper, no spaces, drop -DUP<n> suffix. */
export function normalizeModelCode(code?: string | null): string | null {
  const s = String(code || "").toUpperCase().replace(/\s+/g, "").replace(/-DUP\d*$/, "");
  return s || null;
}

/** "FFA25A9 (X2) + FFA60A9 + 5MXM90A8" -> the first model of a combo; plain codes unchanged. */
export function primaryModelCode(code?: string | null): string | null {
  const first = String(code || "").split("+")[0].replace(/\(\s*x\s*\d+\s*\)/i, "");
  return normalizeModelCode(first);
}

const CODE_LIKE = /^[A-Z0-9][A-Z0-9/\-:*.]{4,}$/;

/** Model key for a quote line, or null when the line must not get a card (fans, materials, labour, services). */
export function unitLineModelKey(line: UnitCardLine): string | null {
  const type = String(line.item_type || "").toLowerCase();
  if (/labour|service|material|consumable|kit/.test(type)) return null;
  const product = { category: line.category, btu_rating: line.btu_rating, capacity_btu: line.capacity_btu, kw: line.kw };
  if (!isAcUnitLine({ item_name: line.item_name, item_type: line.item_type, is_bundle: line.is_bundle, metadata: line.metadata }, product)) return null;
  const key = primaryModelCode(line.product_code) || primaryModelCode(line.item_number);
  return key && CODE_LIKE.test(key) ? key : null;
}

/** One card per model (deduped across rooms), in first-seen order. */
export function buildUnitCards(lines: UnitCardLine[], media: Map<string, ProductMedia> | Record<string, ProductMedia>): UnitCard[] {
  const get = (k: string) => (media instanceof Map ? media.get(k) : (media as Record<string, ProductMedia>)[k]);
  const out = new Map<string, UnitCard>();
  for (const l of lines || []) {
    const key = unitLineModelKey(l);
    if (!key) continue;
    const qty = Math.max(1, Number(l.quantity) || 1);
    const m = get(key);
    const approved = m && (m.status ?? "approved") === "approved" ? m : null;
    const card = out.get(key) ?? {
      modelKey: key,
      modelCode: approved?.model_code || String(l.product_code || l.item_number || key).replace(/-DUP\d*$/i, ""),
      quantity: 0,
      rooms: [],
      media: approved,
      brand: approved?.brand || l.brand || null,
      btu: Number(l.capacity_btu ?? l.btu_rating) || null,
      refrigerant: l.refrigerant_type || null,
      name: approved?.display_name || [l.brand, l.item_name].filter(Boolean).join(" ") || key,
    };
    card.quantity += qty;
    const room = (l.area_name || "").trim();
    if (room && !card.rooms.includes(room)) card.rooms.push(room);
    out.set(key, card);
  }
  return [...out.values()];
}

/** Model keys on the quote that have no row at all yet (=> fetch on demand). */
export function missingModelKeys(lines: UnitCardLine[], known: Iterable<string>): string[] {
  const have = new Set(known);
  const keys = new Set<string>();
  for (const l of lines || []) {
    const k = unitLineModelKey(l);
    if (k && !have.has(k)) keys.add(k);
  }
  return [...keys];
}

/** Spec chips in a fixed order; only values that exist. */
export function specChips(specs?: Record<string, any> | null, fallback?: { btu?: number | null; refrigerant?: string | null }): string[] {
  const s = specs || {};
  const n = (v: any) => (v === null || v === undefined || v === "" ? null : v);
  const chips: string[] = [];
  if (n(s.cool_kw)) chips.push(`${s.cool_kw} kW cool`);
  if (n(s.heat_kw)) chips.push(`${s.heat_kw} kW heat`);
  if (!n(s.cool_kw) && (n(s.btu) || fallback?.btu)) chips.push(`${String(Math.round(Number(s.btu || fallback?.btu))).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} BTU/h`);
  if (n(s.eer) && n(s.cop)) chips.push(`EER ${s.eer} · COP ${s.cop}`);
  else if (n(s.eer)) chips.push(`EER ${s.eer}`);
  else if (n(s.seer)) chips.push(`SEER ${s.seer}`);
  if (n(s.energy_class)) chips.push(`Class ${s.energy_class}`);
  if (n(s.noise_in_db)) chips.push(`${s.noise_in_db} dBA indoor`);
  if (n(s.refrigerant) || fallback?.refrigerant) chips.push(String(s.refrigerant || fallback?.refrigerant));
  if (s.wifi === true) chips.push("Wi-Fi");
  if (n(s.room_m2)) chips.push(`Rooms ≈ ${s.room_m2} m²`);
  if (n(s.warranty)) chips.push(String(s.warranty));
  return chips.slice(0, 7);
}

export function cardLink(card: UnitCard): string | null {
  return card.media?.product_url || card.media?.support_url || null;
}
