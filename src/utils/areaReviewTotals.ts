import type { Basket } from "@/components/catalog/QuoteBuilderTab";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
import { computeQuoteTotals, type QuoteTotals, type QuoteDiscount } from "@/utils/quoteTransformers";
import { isLabourItem } from "@/lib/labour";
import { isJobLabour, normalizeLabourMode, reconcileAutoLabour } from "@/lib/areaLabour";

export interface AreaReviewRow { name: string; totals: QuoteTotals; hours: number; rate: number | null; hasItems: boolean }
export interface AreaReviewSummary { rows: AreaReviewRow[]; totals: QuoteTotals; showCost: boolean }

const norm = (s?: string | null) => (s || "").trim().toLowerCase();

/**
 * Per-area split of the SAME numbers as the header / Visual PDF summary: computeQuoteTotals over the
 * live baskets plus the saved labour rows. Areas group by name; job labour gets its own row.
 * `totals` is the header's own object, so the Review total is the header total.
 */
export function buildAreaReview(baskets: Basket[], ctxItems: any[], ctxAreas: { id: string; name: string }[], totals: QuoteTotals, showCost: boolean): AreaReviewSummary {
  const state = basketsToQuoteState(baskets);
  const basketName = new Map(state.areas.map((a) => [a.id, a.name]));
  const ctxName = new Map(ctxAreas.map((a) => [a.id, a.name]));
  const groups = new Map<string, { name: string; items: any[] }>();
  const add = (name: string, item: any) => {
    const k = norm(name);
    if (!groups.has(k)) groups.set(k, { name: name.trim() || "General", items: [] });
    groups.get(k)!.items.push(item);
  };
  for (const it of state.items) add(basketName.get(it.area_id as string) || "General", it);
  for (const l of ctxItems) {
    if (l.parent_item_id || !isLabourItem(l)) continue;
    add(isJobLabour(l) ? "Job labour" : ctxName.get(l.area_id) || "Other labour", l);
  }
  const rows = [...groups.values()].map((g) => {
    const lab = g.items.filter((i) => isLabourItem(i));
    const hours = lab.reduce((s, i) => s + (Number(i.metadata?.hours ?? i.quantity) || 0), 0);
    const rates = [...new Set(lab.map((i) => Number(i.metadata?.rate ?? i.unit_price) || 0))];
    return {
      name: g.name,
      totals: computeQuoteTotals(g.items, [{ id: "area", name: g.name } as any]),
      hours,
      rate: rates.length === 1 ? rates[0] : null,
      hasItems: g.items.some((i) => !i.parent_item_id && !isLabourItem(i)),
    };
  }).filter((r) => r.totals.itemCount > 0);
  return { rows, totals, showCost };
}

/** Pop-up wizard: totals for just its own areas + their saved labour, with the quote discount (same formula as the header). */
export function buildWizardReview(baskets: Basket[], ctxItems: any[], ctxAreas: { id: string; name: string }[], discount: QuoteDiscount | null, showCost: boolean,
  auto?: { mode: unknown; perUnit: number; rate: number }): AreaReviewSummary {
  const names = new Set(baskets.map((b) => norm(b.name)));
  const ctxName = new Map(ctxAreas.map((a) => [a.id, a.name]));
  const labour = ctxItems.filter((l) => !l.parent_item_id && isLabourItem(l) && !isJobLabour(l) && names.has(norm(ctxName.get(l.area_id))));
  const st = basketsToQuoteState(baskets);
  if (auto) {
    const scopedLabour = ctxItems.filter((l) => !l.parent_item_id && isLabourItem(l) && (isJobLabour(l) || names.has(norm(ctxName.get(l.area_id)))))
      .map((l) => ({ ...l, area_id: st.areas.find((a) => a.id === l.area_id || norm(a.name) === norm(ctxName.get(l.area_id)))?.id ?? l.area_id }));
    const rows = reconcileAutoLabour([...st.items, ...scopedLabour], st.areas, normalizeLabourMode(auto.mode), auto.perUnit, auto.rate);
    return buildAreaReview(baskets, rows, st.areas, computeQuoteTotals(rows, st.areas, undefined, discount), showCost);
  }
  return buildAreaReview(baskets, labour, ctxAreas, computeQuoteTotals([...st.items, ...labour], st.areas, undefined, discount), showCost);
}

