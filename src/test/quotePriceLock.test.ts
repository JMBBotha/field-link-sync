import { describe, it, expect } from "vitest";
import { basketsToQuoteState, calculateBasketItemSell } from "@/utils/quoteBasketTotals";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";
import { buildKitMaterial } from "@/components/catalog/quote-builder/kitLine";
import { areasToBaskets } from "@/components/catalog/quote-builder/QuoteBuilderPopup";
import { createEmptyArea } from "@/components/catalog/quote-builder/quoteWizardTypes";
import type { Basket, PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

/** Simulate: save baskets → reopen (hydrate) → save again, N times. */
function reopen(baskets: Basket[]): Basket[] {
  const { items } = basketsToQuoteState(baskets);
  return [{
    id: "a1",
    name: "Zone 1",
    items: items.map((it) => ({
      instanceId: it.id,
      product: stubProductFromQuoteItem(it),
      quantity: it.quantity,
      ...(it.length ? { length: it.length } : {}),
    })),
  }];
}
const total = (b: Basket[]) => b.flatMap((x) => x.items).reduce((s, i) => s + calculateBasketItemSell(i), 0);

const samsung = {
  id: "11111111-1111-1111-1111-111111111111", product_code: "AR24", short_name: "Samsung 24K",
  brand: "Samsung", product_category: "Air Conditioning", category: "Air Conditioning",
  cost_price: 18614.4, cost_excl_vat: 18614.4, cost_incl_vat: 0, selling_price: 0,
  default_markup_percent: 25, markup_percent: 25, description: "", is_pinned: false, pin_order: null,
  supplier_name: "Samsung", supplier_type: "both", price_per_metre: null, sold_in_length: false,
  unit_length: null, pipe_size: null, is_material_favorite: false, pack_qty: null, supplier_discount_percent: null,
} as PaletteProduct;

describe("quote price lock — reopening a quote never re-applies markup", () => {
  it("Samsung list 23 268: cost (−20%) +25% = list, stable across 5 reopen/save cycles", () => {
    let baskets: Basket[] = [{ id: "a1", name: "Zone 1", items: [{ instanceId: "x", product: samsung, quantity: 1 }] }];
    const first = total(baskets);
    expect(first).toBeCloseTo(23268, 0);
    for (let i = 0; i < 5; i++) baskets = reopen(baskets);
    expect(total(baskets)).toBeCloseTo(first, 2);
  });

  it("a 0-markup row does not pick up the 35% default on reopen", () => {
    const zero = { ...samsung, default_markup_percent: 0, markup_percent: 0, cost_price: 1000, cost_excl_vat: 1000 };
    let baskets: Basket[] = [{ id: "a1", name: "Z", items: [{ instanceId: "y", product: zero, quantity: 2 }] }];
    const first = total(baskets);
    for (let i = 0; i < 3; i++) baskets = reopen(baskets);
    expect(total(baskets)).toBeCloseTo(first, 2);
  });
});

describe("piping kit — collapsed line priced like the palette", () => {
  const pipe = (code: string, coilCost: number) => ({
    ...samsung, id: code, product_code: code, short_name: code, product_category: "Piping",
    category: "Piping", cost_price: coilCost, cost_excl_vat: coilCost, default_markup_percent: 35,
    markup_percent: 35, price_per_metre: coilCost / 15, sold_in_length: true, unit_length: 15, supplier_name: "Other",
  } as PaletteProduct);
  const bundle = {
    id: "b24k", name: "24K Inverter 3/8 5/8 piping kit",
    items: [
      { id: "i1", quantity: 1, length_metres: 3, is_length_item: true, product: pipe("CU38", 1800) },
      { id: "i2", quantity: 1, length_metres: 3, is_length_item: true, product: pipe("CU58", 3000) },
    ],
  };
  const perMetre = (1800 * 1.35 + 3000 * 1.35) / 15; // = 432

  it("1 m of kit = exactly the palette per-metre price", () => {
    const area = { ...createEmptyArea("Lounge"), materials: [buildKitMaterial(bundle, 1)] };
    const baskets = areasToBaskets([area]);
    expect(baskets[0].items).toHaveLength(1);
    expect(calculateBasketItemSell(baskets[0].items[0])).toBeCloseTo(perMetre, 2);
  });

  it("4 m of kit = 4 × per-metre, and survives reopen", () => {
    const area = { ...createEmptyArea("Lounge"), materials: [buildKitMaterial(bundle, 4)] };
    let baskets = areasToBaskets([area]);
    expect(total(baskets)).toBeCloseTo(perMetre * 4, 2);
    baskets = reopen(reopen(baskets));
    expect(total(baskets)).toBeCloseTo(perMetre * 4, 2);
  });
});

describe("Grok review regressions", () => {
  it("pre-fix rows (markup only, no unit_cost) keep their margin on reopen", () => {
    const p = stubProductFromQuoteItem({ id: "r1", unit_price: 1250, quantity: 1, metadata: { markup_percent: 25 } });
    const item = { instanceId: "r1", product: p, quantity: 1 };
    expect(calculateBasketItemSell(item)).toBeCloseTo(1250, 2);
    const { items } = basketsToQuoteState([{ id: "a", name: "A", items: [item] }]);
    expect(Number(items[0].metadata?.markup_percent)).toBeCloseTo(25, 1);
  });

  it("length line with quantity 2 does not shrink on reopen", () => {
    const row = { id: "L1", unit_price: 500, quantity: 2, length: 5, metadata: { unit_cost: 250 } };
    let baskets: Basket[] = [{ id: "a", name: "A", items: [{ instanceId: "L1", product: stubProductFromQuoteItem(row), quantity: 2, length: 5 }] }];
    const first = total(baskets);
    expect(first).toBeCloseTo(1000, 2);
    for (let i = 0; i < 3; i++) baskets = reopen(baskets);
    expect(total(baskets)).toBeCloseTo(first, 2);
    expect(baskets[0].items[0].product.price_per_metre).toBeCloseTo(200, 2);
  });
});
