/**
 * persistQuoteFromBaskets — writes the live builder state (baskets from ALL
 * three tabs: Build, Visual PDF and Build Area Quote) into the single unified
 * quote (quote_areas + quote_items) and refreshes the quote totals.
 *
 * Strategy: replace-all. The builder always holds the complete merged picture
 * of the quote (persisted rows are hydrated back into baskets on load), so a
 * full rewrite guarantees one source of truth instead of three disconnected
 * sets of line items.
 */
import { supabase } from "@/integrations/supabase/client";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
import { computeQuoteTotals, QUOTE_VAT_RATE } from "@/utils/quoteTransformers";
import { isLabourItem, LABOUR_ITEM_TYPE } from "@/lib/labour";
import { remapInstallUnitIds } from "@/lib/installTemplates";
import type { Basket } from "@/components/catalog/QuoteBuilderTab";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersistQuoteResult {
  subtotal: number;
  vatAmount: number;
  total: number;
  itemCount: number;
  zoneCount: number;
}

export async function persistQuoteFromBaskets(
  quoteId: string,
  baskets: Basket[],
  validProductIds?: Set<string>,
): Promise<PersistQuoteResult> {
  const { areas, items } = basketsToQuoteState(baskets);

  // Labour rows live outside the baskets (LabourPanel) — carry them across the
  // replace-all rewrite, re-linked to their area by name. Saved rate is kept.
  const [oldAreasRes, labourRes] = await Promise.all([
    supabase.from("quote_areas").select("id, name").eq("quote_id", quoteId),
    supabase.from("quote_items").select("*").eq("quote_id", quoteId).eq("item_type", LABOUR_ITEM_TYPE),
  ]);
  if (labourRes.error) throw labourRes.error;
  const oldAreaName = new Map((oldAreasRes.data || []).map((a: any) => [a.id, String(a.name || "").trim().toLowerCase()]));
  const labourRows = ((labourRes.data || []) as any[]).filter((r) => isLabourItem(r));
  const totals = computeQuoteTotals([...items, ...(labourRows as any)], areas);

  // 1. Clear existing rows (items first — they reference areas).
  const delItems = await supabase.from("quote_items").delete().eq("quote_id", quoteId);
  if (delItems.error) throw delItems.error;
  const delAreas = await supabase.from("quote_areas").delete().eq("quote_id", quoteId);
  if (delAreas.error) throw delAreas.error;

  // 2. Re-insert areas with fresh ids.
  const areaIdMap = new Map<string, string>();
  const areaRows = areas.map((a, i) => {
    const id = crypto.randomUUID();
    areaIdMap.set(a.id, id);
    return { id, quote_id: quoteId, name: a.name || `Zone ${i + 1}`, sort_order: i };
  });
  if (areaRows.length) {
    const { error } = await supabase.from("quote_areas").insert(areaRows);
    if (error) throw error;
  }

  // 3. Re-insert items.
  // New ids up front so install tags can point at their unit's NEW row id.
  const newIdOf = new Map(items.map((it) => [it.id, crypto.randomUUID()]));
  const itemRows = remapInstallUnitIds(items.map((it, i) => {
    const productId =
      it.product_id && UUID_RE.test(it.product_id) &&
      (!validProductIds || validProductIds.has(it.product_id))
        ? it.product_id
        : null;
    return {
      id: newIdOf.get(it.id)!,
      quote_id: quoteId,
      area_id: it.area_id ? areaIdMap.get(it.area_id) ?? null : null,
      parent_item_id: null,
      product_id: productId,
      item_name: it.item_name,
      item_number: it.item_number,
      description: it.description,
      quantity: it.quantity,
      length: it.length,
      unit_price: it.unit_price,
      total_price: it.total_price,
      is_bundle: it.is_bundle,
      item_type: it.item_type,
      metadata: it.metadata ?? {},
      sort_order: i,
      notes: it.notes,
      source: "builder",
      supplier: it.supplier,
    };
  }), newIdOf);
  if (itemRows.length) {
    const { error } = await supabase.from("quote_items").insert(itemRows as never);
    if (error) throw error;
  }

  // 3b. Re-insert labour rows against the new area ids.
  if (labourRows.length) {
    const newIdByName = new Map(areaRows.map((a) => [a.name.trim().toLowerCase(), a.id]));
    const rows = labourRows.map((r, i) => {
      const { id: _id, created_at: _c, updated_at: _u, area_id, ...rest } = r;
      const nm = area_id ? oldAreaName.get(area_id) : undefined;
      return { ...rest, quote_id: quoteId, area_id: (nm && newIdByName.get(nm)) || null, sort_order: itemRows.length + i };
    });
    const { error } = await supabase.from("quote_items").insert(rows as never);
    if (error) throw error;
  }

  // 4. Refresh the quote header totals.
  const { error: metaErr } = await supabase
    .from("quotes")
    .update({
      subtotal: totals.subtotal,
      vat_rate: QUOTE_VAT_RATE,
      vat_amount: totals.vatAmount,
      total: totals.total,
    })
    .eq("id", quoteId);
  if (metaErr) throw metaErr;

  return {
    subtotal: totals.subtotal,
    vatAmount: totals.vatAmount,
    total: totals.total,
    itemCount: totals.itemCount,
    zoneCount: totals.zoneCount,
  };
}
