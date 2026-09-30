import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";
import { standardSell, markupDrift, quoteLineDrift, canMergeRepick, freshProduct } from "@/lib/priceGuard";
import { getEffectiveUnitPrices, type PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { basketsToQuoteState } from "@/utils/quoteBasketTotals";
import { stubProductFromQuoteItem } from "@/utils/hydrateQuoteItem";
import { catalogLineFields, kitRowFields } from "@/lib/mandy/quoteOps";
import { productLine } from "@/lib/voiceQuoteKit";
import { selectRegion } from "@/components/catalog/quote-builder/PdfPageOverlay";
import { buildKitMaterial } from "@/components/catalog/quote-builder/kitLine";
import { draftSafeAreas } from "@/utils/repriceAreas";
import { createEmptyArea } from "@/components/catalog/quote-builder/quoteWizardTypes";

// Midea INVEXT-24-R32: catalogue 20%, company Units rate 25% wins inside a quote -> 17,434.21.
const MIDEA = {
  id: "0b0b0b0b-0000-4000-8000-000000000024", product_code: "INVEXT-24-R32", short_name: "Midea 24K INV MW", brand: "Midea",
  product_category: "Air Conditioning", category: "Air Conditioning", cost_price: 13947.37, cost_excl_vat: 13947.37,
  default_markup_percent: 20, markup_percent: 20, supplier_name: "Midea", supplier_type: "ac_units",
} as unknown as PaletteProduct;
const STD = 17434.21;
const pipe = (code: string, cost: number, len: number) => ({ quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables", cost_price: cost,
    cost_excl_vat: cost, price_per_metre: cost / len, sold_in_length: true, unit_length: len, default_markup_percent: 100, supplier_name: "OSS" } });
const KIT = { id: "k24", name: "24K PIPING KIT", items: [pipe("CU38", 1265.44, 15.24), pipe("CU58", 2163.06, 15.24), pipe("IT010", 15.46, 1.8)] };
const quoteOpen = () => setActiveQuoteMarkupRates({ units: 25, materials: 100 });
afterEach(() => setActiveQuoteMarkupRates(null));
const snapshot = JSON.stringify(MIDEA);

describe("price guard: every add path = cost x (1 + standard markup)", () => {
  it("shared helper", () => { quoteOpen(); expect(standardSell(13947.37, 25)).toBe(STD); });
  it("builder catalogue add (baskets autosave)", () => {
    quoteOpen();
    expect(basketsToQuoteState([{ id: "b", name: "Z", items: [{ instanceId: "x", product: MIDEA, quantity: 1 }] }]).items[0].unit_price).toBe(STD);
    expect(Math.round(getEffectiveUnitPrices(MIDEA).unitSell * 100) / 100).toBe(STD);
  });
  it("estimate picker + in-app Mandy shared add (catalogLineFields)", () => { quoteOpen(); expect(catalogLineFields(MIDEA, 1).unit_price).toBe(STD); });
  it("Mandy voice line", () => { quoteOpen(); expect(productLine(MIDEA, 1).unitPrice).toBe(STD); });
  it("PDF basket / Add to quote", () => {
    quoteOpen();
    let picked: any = null;
    selectRegion({ id: "r1", product: MIDEA, product_code: "INVEXT-24-R32", label: "Midea" } as any,
      { selectedFromPdf: [], handleSelectProduct: (p: any) => { picked = p; } } as any, []);
    expect(Number(picked.price)).toBe(STD);
    expect(picked.markupPercent).toBe(25);
  });
  it("bundles / auto-install kit and piping-kit recipe", () => {
    quoteOpen();
    const k = buildKitMaterial(KIT as any).kit!;
    expect(k.unitSell).toBeCloseTo(k.unitCost * 2, 6);
    const f = kitRowFields(KIT as any, 12).fields;
    expect(markupDrift(f.unit_price, f.metadata.unit_cost, 100)).toBeNull();
  });
});

describe("markup overrides are per quote and never persist to the product", () => {
  const overrideLine = { item_type: "product", item_name: "Midea 24K INV MW", item_number: "INVEXT-24-R32", product_id: MIDEA.id,
    quantity: 1, unit_price: standardSell(13947.37, 32), metadata: { unit_cost: 13947.37, markup_percent: 25 } };
  it("(a) override on quote A, then the same product on quote B starts at standard", () => {
    quoteOpen();
    const stubA = stubProductFromQuoteItem({ id: "a1", ...overrideLine });
    expect(canMergeRepick(stubA, MIDEA)).toBe(false); // re-pick on A: new line, not the override
    setActiveQuoteMarkupRates({ units: 25, materials: 100 }); // quote B
    expect(catalogLineFields(MIDEA, 1).unit_price).toBe(STD);
    expect(getEffectiveUnitPrices(freshProduct(stubA)).unitSell).toBeCloseTo(STD, 2);
  });
  it("(b) reopen quote A keeps the override and shows the warn chip", () => {
    quoteOpen();
    const stub = stubProductFromQuoteItem({ id: "a1", ...overrideLine });
    expect(basketsToQuoteState([{ id: "b", name: "Z", items: [{ instanceId: "a1", product: stub, quantity: 1 }] }]).items[0].unit_price).toBe(overrideLine.unit_price);
    expect(quoteLineDrift(overrideLine, MIDEA)!.label).toMatch(/^markup 32% vs standard 25% \(\+7%, \+R976\.32\)$/);
    expect(quoteLineDrift({ ...overrideLine, unit_price: STD }, MIDEA)).toBeNull();
  });
  it("(c) product row, favourites and company rates are never written from a quote line", () => {
    quoteOpen();
    catalogLineFields(MIDEA, 1); stubProductFromQuoteItem({ id: "a1", ...overrideLine });
    expect(JSON.stringify(MIDEA)).toBe(snapshot);
    for (const f of ["src/components/quoting/EstimateBuilder.tsx", "src/contexts/QuoteContext.tsx", "src/utils/persistQuoteFromBaskets.ts",
      "src/lib/mandy/quoteOps.ts", "src/components/shared/SharedBasketItems.tsx", "src/components/catalog/QuoteBuilderTab.tsx",
      "src/pages/admin/AdminQuoteBuilderPageUnified.tsx", "src/components/catalog/quote-builder/AreaQuoteBuilderInline.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/from\("(supplier_products|companies|product_favorites)"\)[^;]*\.(update|upsert|insert)\(/);
    }
    expect(readFileSync("src/components/shared/ProductInfoDialog.tsx", "utf8")).toMatch(/isAdmin && !inQuote/);
  });
  it("local-storage drafts keep no override (saved at standard)", () => {
    quoteOpen();
    const a = { ...createEmptyArea("A"), acUnits: [{ id: "u", btu: 24000, quantity: 1, product: { ...stubProductFromQuoteItem({ id: "a1", ...overrideLine }), manual_price_override: true } }] };
    expect(draftSafeAreas([a as any])[0].acUnits[0].product.locked_sell_ex_vat).toBe(STD);
  });
  it("warn chip is warn-only: send path does not use it", () => {
    expect(readFileSync("src/lib/quoteSend.ts", "utf8")).not.toMatch(/priceGuard|markupDrift/);
  });
});
