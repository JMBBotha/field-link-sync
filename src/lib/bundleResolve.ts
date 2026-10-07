/**
 * BUNDLES KEY OFF MODEL NUMBERS: each bundle item resolves at quote time to the LIVE
 * supplier_products row whose product_code matches bundle_items.model_number
 * (case/space/hyphen-insensitive, same supplier preferred). Price = live cost at
 * standard markup. No live match → a zero-priced "Not found: <model> – remap"
 * placeholder (never the old price, never silently skipped); the R0 guard blocks send.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveProductMarkupPercent } from "@/lib/pricing";
import { fetchActiveUploadIds, isLiveCatalogProduct } from "@/lib/catalogSoT";
import { fetchAllPages } from "@/lib/fetchAllPages";

export const normCode = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[\s\-_/.]+/g, "");
export const NOT_FOUND_PREFIX = "Not found: ";
export const notFoundName = (model: string) => `${NOT_FOUND_PREFIX}${model} – remap`;
export const isNotFoundName = (n: unknown) => typeof n === "string" && n.startsWith(NOT_FOUND_PREFIX);

export type LiveProductRow = Record<string, any> & { id: string; product_code: string | null; supplier_id?: string | null };

const PRODUCT_COLS =
  "id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, cost_price, default_markup_percent, supplier_discount_percent, markup_percent, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pack_qty, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, is_active, archived, pdf_upload_id, supplier_id, search_tags, suppliers(name)";

/** Same shape the bundle loaders always produced for item.product. */
export function toPaletteProduct(sp: Record<string, any>) {
  return {
    ...sp,
    product_category: sp.product_category || sp.category || "",
    supplier_name: sp.suppliers?.name || "",
    price_per_metre: sp.price_per_metre || null,
    sold_in_length: sp.sold_in_length || false,
    unit_length: sp.unit_length || null,
    cost_price: sp.cost_price ?? 0,
    default_markup_percent: resolveProductMarkupPercent(sp as any),
    supplier_discount_percent: sp.supplier_discount_percent ?? null,
    markup_percent: sp.markup_percent ?? null,
    unit_type: sp.unit_type || null,
    price_per_unit_qty: sp.price_per_unit_qty ?? 1,
    price_per_unit_label: sp.price_per_unit_label || "each",
    allows_decimal_qty: sp.allows_decimal_qty ?? false,
    qty_step: sp.qty_step ?? 1,
    min_qty: sp.min_qty ?? 1,
  };
}

/** Pure resolver: live row for a model number, same supplier first. */
export function resolveBundleItem(
  item: { model_number?: string | null; supplier_id?: string | null },
  live: LiveProductRow[],
): LiveProductRow | null {
  const key = normCode(item.model_number);
  if (!key) return null;
  const hits = live.filter((p) => normCode(p.product_code) === key);
  if (!hits.length) return null;
  return hits.find((p) => item.supplier_id && p.supplier_id === item.supplier_id) ?? hits[0];
}

export function notFoundProduct(model: string, keepId: string | null) {
  const name = notFoundName(model || "unknown");
  return {
    id: keepId, product_code: model || null, short_name: name, description: name, brand: null,
    product_category: "", category: "", cost_excl_vat: 0, cost_incl_vat: 0, cost_price: 0, selling_price: 0,
    default_markup_percent: 0, markup_percent: 0, price_per_metre: null, sold_in_length: false, unit_length: null,
    pack_qty: null, price_per_unit_qty: 1, price_per_unit_label: "each", allows_decimal_qty: false, qty_step: 1, min_qty: 1,
    supplier_name: "", bundle_not_found: true,
  };
}

export async function loadLiveProducts(): Promise<LiveProductRow[]> {
  const [{ data }, active] = await Promise.all([
    fetchAllPages<any>((from, to) => (supabase.from("supplier_products") as any).select(PRODUCT_COLS).eq("is_active", true).order("id").range(from, to)),
    fetchActiveUploadIds(),
  ]);
  return ((data || []) as LiveProductRow[]).filter((p) => isLiveCatalogProduct(p as any, active));
}

type ItemMeta = { id: string; model_number: string | null; supplier_product_id: string | null; match_status: string | null; supplier_id: string | null; linked_code: string | null };

export async function loadBundleItemMeta(ids?: string[]): Promise<ItemMeta[]> {
  let q: any = (supabase.from("bundle_items") as any).select("id, bundle_id, model_number, supplier_product_id, match_status, supplier_products(product_code, supplier_id)");
  if (ids) q = q.in("id", ids);
  const { data } = await q;
  return ((data || []) as any[]).map((r) => ({
    id: r.id, bundle_id: r.bundle_id, model_number: r.model_number, supplier_product_id: r.supplier_product_id, match_status: r.match_status,
    supplier_id: r.supplier_products?.supplier_id ?? null, linked_code: r.supplier_products?.product_code ?? null,
  }));
}

/** Swap every bundle item's product for its live model-number match (or a not-found placeholder). */
export async function resolveBundlesLive<B extends { items: any[] }>(bundles: B[]): Promise<B[]> {
  const ids = bundles.flatMap((b) => b.items.map((i) => i.id)).filter(Boolean);
  if (!ids.length) return bundles;
  const [live, meta] = await Promise.all([loadLiveProducts(), loadBundleItemMeta(ids)]);
  const byId = new Map(meta.map((m) => [m.id, m]));
  return bundles.map((b) => ({
    ...b,
    items: b.items.map((i) => {
      const m = byId.get(i.id);
      const model = m?.model_number || m?.linked_code || i.product?.product_code || "";
      const hit = resolveBundleItem({ model_number: model, supplier_id: m?.supplier_id }, live);
      if (hit) return { ...i, supplier_product_id: hit.id, product: toPaletteProduct(hit), match_status: "found" };
      return { ...i, product: notFoundProduct(model, i.supplier_product_id ?? null), match_status: "not_found" };
    }),
  }));
}

export interface BundleCheckLine { itemId: string; bundleId: string; found: boolean; model: string; name: string; text: string; status: string }

/** "Check bundles": per item Found / Not found; writes match_status (keeps 'remapped' when still found). */
export async function checkAllBundles(): Promise<{ bundles: { id: string; name: string; lines: BundleCheckLine[] }[] }> {
  const [{ data: bundles }, live, meta] = await Promise.all([
    supabase.from("installation_bundles").select("id, name").order("name"),
    loadLiveProducts(),
    loadBundleItemMeta(),
  ]);
  const out: { id: string; name: string; lines: BundleCheckLine[] }[] = [];
  for (const b of (bundles || []) as any[]) {
    const lines: BundleCheckLine[] = [];
    for (const m of meta.filter((x: any) => x.bundle_id === b.id)) {
      const model = m.model_number || m.linked_code || "";
      const hit = resolveBundleItem({ model_number: model, supplier_id: m.supplier_id }, live);
      const status = hit ? (m.match_status === "remapped" ? "remapped" : "found") : "not_found";
      const name = hit?.short_name || hit?.description || model;
      lines.push({
        itemId: m.id, bundleId: b.id, found: !!hit, model, name, status,
        text: hit ? `Found ${name} (${model})` : `Could not find ${model || "an item with no model number"}`,
      });
      const patch: Record<string, any> = {};
      if (m.match_status !== status) patch.match_status = status;
      if (!m.model_number && model) patch.model_number = model;
      if (hit && hit.id !== m.supplier_product_id) patch.supplier_product_id = hit.id;
      if (Object.keys(patch).length) await (supabase.from("bundle_items") as any).update(patch).eq("id", m.id);
    }
    out.push({ id: b.id, name: b.name, lines });
  }
  return { bundles: out };
}

export async function remapBundleItem(itemId: string, product: { id: string; product_code: string | null }) {
  const { data, error } = await (supabase.from("bundle_items") as any)
    .update({ supplier_product_id: product.id, model_number: product.product_code, match_status: "remapped" })
    .eq("id", itemId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Not allowed to change this bundle");
}
