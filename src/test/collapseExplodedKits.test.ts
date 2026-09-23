import { describe, it, expect } from "vitest";
import { collapseExplodedKits, kitFromSavedItem, withKitLength, buildKitMaterial } from "@/components/catalog/quote-builder/kitLine";

const p = (code: string, ppm: number | null = null) => ({
  id: code, product_code: code, short_name: code, cost_price: ppm ?? 10, cost_excl_vat: ppm ?? 10,
  price_per_metre: ppm, default_markup_percent: 25, markup_percent: 25,
} as any);
const bundle24k = {
  id: "6b62cd00-0000", name: "24K Piping Kit",
  items: [
    { quantity: 1, is_length_item: true, product: p("COPRL004", 100) },
    { quantity: 1, is_length_item: true, product: p("COPRL002", 60) },
    { quantity: 1, is_length_item: true, product: p("IT010", 40) },
    { quantity: 1, is_length_item: true, product: p("IT012", 50) },
    { quantity: 1, is_length_item: false, product: p("TAPE006") },
  ],
};
const line = (code: string, total: number) => ({
  id: `l-${code}`, item_number: code, is_bundle: false, length: 1, quantity: 1,
  unit_price: total, total_price: total, metadata: { markup_percent: 25 },
});

describe("collapse exploded piping kits on hydrate", () => {
  const saved = [line("COPRL004", 180), line("COPRL002", 110), line("IT010", 70), line("IT012", 80), line("TAPE006", 53.38), line("AR24", 17825)];
  it("Q-2026-0012 pattern: 5 lines → 1 kit, total preserved", () => {
    const out = collapseExplodedKits(saved, [bundle24k]);
    expect(out).toHaveLength(2);
    const kits = out.map(kitFromSavedItem).filter(Boolean);
    expect(kits).toHaveLength(1);
    const k = kits[0]!;
    expect(k.totalCost).toBeCloseTo(493.38, 2);
    expect(k.kit!.items).toHaveLength(5);
    expect(withKitLength(k, 3).totalCost).toBeCloseTo(493.38 * 3, 2);
  });
  it("leaves partial matches alone", () => {
    const out = collapseExplodedKits(saved.filter((l) => l.item_number !== "IT012"), [bundle24k]);
    expect(out.every((l) => !l.is_bundle)).toBe(true);
  });
  it("new add path is still one line", () => {
    const m = buildKitMaterial(bundle24k as any, 1);
    expect(m.kit).toBeTruthy();
  });
});
