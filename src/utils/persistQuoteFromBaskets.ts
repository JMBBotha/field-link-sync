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

const inFlight = new Map<string, Promise<unknown>>();

/** Per-quote single-flight queue: calls for the same quote run strictly one after another. */
export function runSerialPerQuote<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(quoteId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  const tail = next.catch(() => undefined);
  inFlight.set(quoteId, tail);
  void tail.then(() => { if (inFlight.get(quoteId) === tail) inFlight.delete(quoteId); });
  return next;
}

export function persistQuoteFromBaskets(
  quoteId: string,
  baskets: Basket[],
  validProductIds?: Set<string>,
): Promise<PersistQuoteResult> {
  return runSerialPerQuote(quoteId, () => persistOnce(quoteId, baskets, validProductIds));
}

async function persistOnce(
  quoteId: string,
  baskets: Basket[],
  validProductIds?: Set<string>,
): Promise<PersistQuoteResult> {
  const { areas, items } = basketsToQuoteState(baskets);

  // Labour rows live outside the baskets. They are never re-inserted: the RPC
  // re-links them to the new area by name. Read once only for totals.
  const labourRes = await supabase.from("quote_items").select("*").eq("quote_id", quoteId).eq("item_type", LABOUR_ITEM_TYPE);
  if (labourRes.error) throw labourRes.error;
  const labourRows = ((labourRes.data || []) as any[]).filter((r) => isLabourItem(r) && !r.parent_item_id);
  const totals = computeQuoteTotals([...items, ...(labourRows as any)], areas);

  const areaIdMap = new Map<string, string>();
  const areaRows = areas.map((a, i) => {
    const id = crypto.randomUUID();
    areaIdMap.set(a.id, id);
    // old_id lets the RPC re-link labour rows by identity (survives renames);
    // only sent when the basket id is a real DB area id.
    const oldId = UUID_RE.test(a.id) ? a.id : null;
    return { id, old_id: oldId, quote_id: quoteId, name: a.name || `Zone ${i + 1}`, sort_order: i };
  });

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
  const { error } = await (supabase as any).rpc("replace_quote_from_builder", {
    p_quote_id: quoteId,
    p_areas: areaRows,
    p_items: itemRows,
    p_subtotal: totals.subtotal,
    p_vat_rate: QUOTE_VAT_RATE,
    p_vat_amount: totals.vatAmount,
    p_total: totals.total,
  });
  if (error) throw error;

  return {
    subtotal: totals.subtotal,
    vatAmount: totals.vatAmount,
    total: totals.total,
    itemCount: totals.itemCount,
    zoneCount: totals.zoneCount,
  };
}
