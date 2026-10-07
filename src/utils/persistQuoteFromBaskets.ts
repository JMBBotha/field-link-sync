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
import { stampChanged, stampFromRows, type QuoteLineStamp } from "@/lib/quoteLineStamp";
import { normalizeLabourMode, reconcileAutoLabour, syncAutoLabour } from "@/lib/areaLabour";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PersistQuoteResult {
  subtotal: number;
  vatAmount: number;
  total: number;
  itemCount: number;
  zoneCount: number;
  /** Ids of the quote_items rows this save wrote (non-labour). */
  writtenIds: string[];
}

export class QuoteChangedElsewhereError extends Error {
  constructor() { super("This quote was changed on the estimate page or another device."); this.name = "QuoteChangedElsewhereError"; }
}

const isKeptLabour = (r: any) => r.item_type === LABOUR_ITEM_TYPE && isLabourItem(r) && !r.parent_item_id;

/** Stamp over the quote's non-labour lines (labour excluded exactly as persistOnce does). */
export async function fetchQuoteLineStamp(quoteId: string): Promise<QuoteLineStamp> {
  const { data, error } = await (supabase.from("quote_items") as any)
    .select("id, updated_at, item_type, metadata, parent_item_id").eq("quote_id", quoteId);
  if (error) throw error;
  return stampFromRows(((data || []) as any[]).filter((r) => !isKeptLabour(r)));
}

/** Stamp over exactly these row ids. */
export async function fetchStampForIds(ids: string[]): Promise<QuoteLineStamp> {
  if (!ids.length) return { ids: new Set(), maxUpdatedAt: null };
  const { data, error } = await (supabase.from("quote_items") as any).select("id, updated_at").in("id", ids);
  if (error) throw error;
  return { ...stampFromRows((data || []) as any[]), ids: new Set(ids) };
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

/** Resolves once every queued builder save for this quote has finished. */
export function waitForBuilderSaves(quoteId: string): Promise<void> {
  return (inFlight.get(quoteId) ?? Promise.resolve()).then(() => undefined, () => undefined);
}

export function persistQuoteFromBaskets(
  quoteId: string,
  baskets: Basket[],
  validProductIds?: Set<string>,
  opts?: { baseline?: () => QuoteLineStamp | null },
): Promise<PersistQuoteResult> {
  return runSerialPerQuote(quoteId, async () => {
    const base = opts?.baseline?.();
    if (base && stampChanged(base, await fetchQuoteLineStamp(quoteId))) throw new QuoteChangedElsewhereError();
    return persistOnce(quoteId, baskets, validProductIds);
  });
}

async function persistOnce(
  quoteId: string,
  baskets: Basket[],
  validProductIds?: Set<string>,
): Promise<PersistQuoteResult> {
  const { areas, items } = basketsToQuoteState(baskets);

  // Labour rows live outside the baskets. They are never re-inserted: the RPC
  // re-links them to the new area by identity/name. Reconcile auto rows after replacement.
  const [labourRes, quoteRes, oldAreasRes, settingsRes] = await Promise.all([
    supabase.from("quote_items").select("*").eq("quote_id", quoteId).eq("item_type", LABOUR_ITEM_TYPE),
    supabase.from("quotes").select("discount_type, discount_value, labour_mode").eq("id", quoteId),
    supabase.from("quote_areas").select("id, name").eq("quote_id", quoteId),
    supabase.from("company_settings").select("default_install_labour_hours, default_hourly_rate").order("updated_at", { ascending: false }).limit(1),
  ]);
  if (labourRes.error) throw labourRes.error;
  if (quoteRes.error || oldAreasRes.error || settingsRes.error) throw quoteRes.error || oldAreasRes.error || settingsRes.error;
  const labourRows = ((labourRes.data || []) as any[]).filter((r) => isLabourItem(r) && !r.parent_item_id);
  // Saved VAT/total take the quote discount off before VAT (matches the DB trigger and the client PDF).
  const qd = ((quoteRes as any)?.data as any[] | null)?.[0];
  const settings = settingsRes.data?.[0];
  const oldAreas = oldAreasRes.data || [];
  const projectedLabour = labourRows.map((row) => {
    const old = oldAreas.find((a) => a.id === row.area_id);
    const next = areas.find((a) => a.id === row.area_id) ?? areas.find((a) => old && a.name.trim().toLowerCase() === old.name.trim().toLowerCase());
    return { ...row, area_id: next?.id ?? row.area_id };
  });
  const mode = normalizeLabourMode(qd?.labour_mode);
  const perUnit = Number(settings?.default_install_labour_hours) || 3.5;
  const rate = Number(settings?.default_hourly_rate) || 0;
  const working = reconcileAutoLabour([...items, ...projectedLabour], areas, mode, perUnit, rate);
  const checked = async (request: any) => {
    const res = await request.select("id");
    if (res.error || !res.data?.length) throw new Error(res.error?.message || "Automatic labour was not saved.");
  };
  const totals = computeQuoteTotals(working, areas, undefined, qd ? { type: qd.discount_type, value: qd.discount_value } : null);

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

  // Areas now exist and existing labour has been re-linked by the transaction.
  // Never re-insert existing labour or create temporary unassigned labour rows.
  const currentLabour = projectedLabour.map((row) => ({ ...row, area_id: areaIdMap.get(row.area_id) ?? row.area_id }));
  await syncAutoLabour([...itemRows, ...currentLabour], areaRows, mode, perUnit, rate, {
    add: async (fields) => { await checked(supabase.from("quote_items").insert({ ...fields, id: crypto.randomUUID(), quote_id: quoteId, source: "labour", sort_order: itemRows.length })); },
    update: async (id, fields) => { await checked(supabase.from("quote_items").update(fields).eq("id", id).eq("quote_id", quoteId)); },
    remove: async (id) => { await checked(supabase.from("quote_items").delete().eq("id", id).eq("quote_id", quoteId)); },
  });

  return {
    subtotal: totals.subtotal,
    vatAmount: totals.vatAmount,
    total: totals.total,
    itemCount: totals.itemCount,
    zoneCount: totals.zoneCount,
    writtenIds: itemRows.map((r: any) => r.id),
  };
}
