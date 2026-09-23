import { describe, it, expect } from "vitest";
import { computeQuoteTotals } from "@/utils/quoteTransformers";

const line = (id: string, type: string, cost: number, markup: number): any => ({
  id, item_type: type, quantity: 1, unit_price: cost * (1 + markup / 100),
  total_price: cost * (1 + markup / 100), metadata: { total_cost: cost, markup_percent: markup },
});

describe("per-line category markup roll-up (Johan worked example)", () => {
  const items = [
    line("u", "air conditioner", 7000, 25),
    line("m", "materials", 2000, 100),
    // Pure maths check: third slice priced like materials (real labour is flat, see ACCEPTANCE test)
    line("l", "materials", 1000, 100),
  ];
  const t = computeQuoteTotals(items, []);
  it("sums line sells and costs", () => {
    expect(t.subtotal).toBeCloseTo(14750, 2);
    expect(t.totalCost).toBeCloseTo(10000, 2);
    expect(t.profit).toBeCloseTo(4750, 2);
  });
  it("overall markup = 47.5% (not 25, 100, 62.5 or 125)", () => {
    expect(t.avgMarkup).toBeCloseTo(47.5, 5);
    expect(0.7 * 25 + 0.2 * 100 + 0.1 * 100).toBeCloseTo(t.avgMarkup, 5);
  });
  it("overall margin ≈ 32.2% on sell", () => {
    expect(t.marginPercent).toBeCloseTo((4750 / 14750) * 100, 5);
  });
  it("25% markup = 20% margin; 100% markup = 50% margin", () => {
    expect(computeQuoteTotals([line("a", "air conditioner", 100, 25)], []).marginPercent).toBeCloseTo(20, 5);
    expect(computeQuoteTotals([line("b", "materials", 100, 100)], []).marginPercent).toBeCloseTo(50, 5);
  });
});

import {
  classifyQuoteCategory, categoryMarkupPercent, resolveProductMarkupPercent,
  setActiveQuoteMarkupRates, DEFAULT_CATEGORY_MARKUPS,
} from "@/lib/pricing";
import { afterEach } from "vitest";

describe("Johan 2-line example (units 25%, materials 100%)", () => {
  it("R10 000 unit + R2 000 materials → 37.5% markup, 27.3% margin", () => {
    const t = computeQuoteTotals([line("u", "Air Conditioning", 10000, 25), line("m", "Consumables", 2000, 100)], []);
    expect(t.subtotal).toBeCloseTo(16500, 2);
    expect(t.totalCost).toBeCloseTo(12000, 2);
    expect(t.profit).toBeCloseTo(4500, 2);
    expect(t.avgMarkup).toBeCloseTo(37.5, 5);
    expect(t.marginPercent).toBeCloseTo(27.27, 1);
  });
});

describe("discount-aware profit (after discount, before VAT)", () => {
  it("10% discount on the worked example", () => {
    const items = [line("u", "Air Conditioning", 7000, 25), line("m", "Consumables", 2000, 100), line("x", "Consumables", 1000, 100)];
    const t = computeQuoteTotals(items, [], undefined, { type: "percentage", value: 10 });
    expect(t.discountAmount).toBeCloseTo(1475, 2);
    expect(t.profit).toBeCloseTo(13275 - 10000, 2);
    expect(t.avgMarkup).toBeCloseTo(32.75, 5);
    expect(t.marginPercent).toBeCloseTo((3275 / 13275) * 100, 5);
    // VAT behaviour unchanged by this rule
    expect(t.subtotal).toBeCloseTo(14750, 2);
  });
  it("fixed discount", () => {
    const t = computeQuoteTotals([line("u", "Air Conditioning", 10000, 25)], [], undefined, { type: "fixed", value: 500 });
    expect(t.profit).toBeCloseTo(2000, 2);
  });
});

describe("labour = flat rate, no markup, own line", () => {
  const labour: any = { id: "l", item_type: "service", item_name: "Installation labour", quantity: 1, unit_price: 1500, total_price: 1500, metadata: {} };
  it("labour adds cost = sell, zero profit, not in materials markup", () => {
    const t = computeQuoteTotals([line("u", "Air Conditioning", 10000, 25), line("m", "Consumables", 2000, 100), labour], []);
    expect(t.labourTotal).toBe(1500);
    expect(t.totalCost).toBeCloseTo(13500, 2);
    expect(t.profit).toBeCloseTo(4500, 2);
    expect(t.materialsMarkup).toBeCloseTo(100, 5);
    expect(t.unitsMarkup).toBeCloseTo(25, 5);
    expect(t.noCostCount).toBe(0);
  });
  it("labour never gets a markup", () => {
    expect(categoryMarkupPercent("labour", { units: 25, materials: 100 })).toBe(0);
    expect(classifyQuoteCategory({ item_type: "service", item_name: "Service call" })).toBe("labour");
  });
});

describe("no-cost lines are counted and left out", () => {
  it("counts them", () => {
    const bare: any = { id: "b", item_type: "Consumables", quantity: 1, unit_price: 100, total_price: 100, metadata: {} };
    const t = computeQuoteTotals([line("u", "Air Conditioning", 1000, 25), bare], []);
    expect(t.noCostCount).toBe(1);
    expect(t.avgMarkup).toBeCloseTo(25, 5);
  });
});

describe("category fallback + quote-level override", () => {
  afterEach(() => setActiveQuoteMarkupRates(null));
  const unit = { product_category: "Air Conditioning", short_name: "Midea 24K INV MW", default_markup_percent: 20 };
  const mat = { product_category: "Consumables", short_name: "Copper pipe 3/8", default_markup_percent: 20 };
  it("outside a quote: catalogue markup (then 35 as last resort)", () => {
    expect(resolveProductMarkupPercent(unit)).toBe(20);
    expect(resolveProductMarkupPercent({})).toBe(35);
  });
  it("inside a quote: category default wins over catalogue markup", () => {
    setActiveQuoteMarkupRates(DEFAULT_CATEGORY_MARKUPS);
    expect(resolveProductMarkupPercent(unit)).toBe(25);
    expect(resolveProductMarkupPercent(mat)).toBe(100);
  });
  it("quote override beats the category default", () => {
    setActiveQuoteMarkupRates({ units: 30, materials: 80 });
    expect(resolveProductMarkupPercent(unit)).toBe(30);
    expect(resolveProductMarkupPercent(mat)).toBe(80);
  });
  it("accessories in the AC category are materials", () => {
    expect(classifyQuoteCategory({ product_category: "Air Conditioning", short_name: "M8 Raw Bolts" })).toBe("materials");
    expect(classifyQuoteCategory({ product_category: "Air Conditioning", short_name: "Membrane pump with float switch" })).toBe("materials");
  });
});

import { applyCategoryRatesToBaskets } from "@/utils/quoteBasketTotals";
describe("editing quote rates reprices saved lines", () => {
  it("locked unit + kit reprice from saved cost; labour untouched", () => {
    const baskets: any = [{ id: "a", name: "Living", items: [
      { instanceId: "1", quantity: 1, product: { product_category: "Air Conditioning", short_name: "Samsung 24K INV", locked_sell_ex_vat: 12000, locked_cost_ex_vat: 10000 } },
      { instanceId: "2", quantity: 1, length: 3, isBundle: true, bundlePricingType: "p/meter", bundleUnitCost: 250, bundleUnitPrice: 493.38, product: { short_name: "24K kit", locked_sell_ex_vat: 493.38, locked_cost_ex_vat: 250 } },
      { instanceId: "3", quantity: 1, product: { product_category: "Service", short_name: "Installation labour", locked_sell_ex_vat: 1500, locked_cost_ex_vat: 1500 } },
    ] }];
    const out = applyCategoryRatesToBaskets(baskets, { units: 30, materials: 80 });
    expect(out[0].items[0].product.locked_sell_ex_vat).toBe(13000);
    expect(out[0].items[1].bundleUnitPrice).toBe(450);
    expect(out[0].items[2].product.locked_sell_ex_vat).toBe(1500);
  });
});

import { allocateQuoteDiscount, blendedMarkupHealth } from "@/utils/quoteTransformers";
import { applyCategoryRatesToAreas } from "@/utils/repriceAreas";

describe("ACCEPTANCE (Johan/Grok): unit 10000, materials 2000, labour 3000 flat", () => {
  const lab: any = { id: "lab", item_type: "service", item_name: "Installation labour", quantity: 1, unit_price: 3000, total_price: 3000, metadata: {} };
  const items = () => [line("u", "Air Conditioning", 10000, 25), line("m", "Consumables", 2000, 100), lab];
  it("no discount", () => {
    const t = computeQuoteTotals(items(), []);
    expect(t.totalCost).toBeCloseTo(15000, 2);
    expect(t.subtotal).toBeCloseTo(19500, 2);
    expect(t.profit).toBeCloseTo(4500, 2);
    expect(t.avgMarkup.toFixed(1)).toBe("30.0");
    expect(t.marginPercent.toFixed(1)).toBe("23.1");
    expect(t.unitsMaterialsMarkup!.toFixed(1)).toBe("37.5");
    expect(t.labourTotal).toBe(3000);
  });
  it("R1000 discount before VAT", () => {
    const t = computeQuoteTotals(items(), [], undefined, { type: "fixed", value: 1000 });
    expect(t.subtotal - t.discountAmount).toBeCloseTo(18500, 2);
    expect(t.profit).toBeCloseTo(3500, 2);
    expect(t.avgMarkup.toFixed(1)).toBe("23.3");
    expect(t.marginPercent.toFixed(1)).toBe("18.9");
  });
  it("discount is never allocated to labour; spread by units/materials sell", () => {
    const share = allocateQuoteDiscount(items(), 1000);
    expect(share.get("lab")).toBeUndefined();
    expect(share.get("u")!).toBeCloseTo(1000 * 12500 / 16500, 6);
    expect(share.get("m")!).toBeCloseTo(1000 * 4000 / 16500, 6);
  });
});

describe("colour bands: green ≥35, amber 25–34.9, red <25", () => {
  it("bands", () => {
    expect(blendedMarkupHealth(35)).toBe("Good");
    expect(blendedMarkupHealth(34.9)).toBe("Fair");
    expect(blendedMarkupHealth(25)).toBe("Fair");
    expect(blendedMarkupHealth(24.9)).toBe("Low");
  });
});

describe("no-cost lines are never R0 cost; sell still in total", () => {
  it("sell counted, cost not", () => {
    const bare: any = { id: "b", item_type: "Consumables", quantity: 1, unit_price: 500, total_price: 500, metadata: {} };
    const t = computeQuoteTotals([line("u", "Air Conditioning", 1000, 25), bare], []);
    expect(t.subtotal).toBeCloseTo(1750, 2);
    expect(t.totalCost).toBeCloseTo(1000, 2);
    expect(t.noCostCount).toBe(1);
  });
});

describe("manual line edits survive a rate change", () => {
  it("basket + area", () => {
    const manual = { product_category: "Air Conditioning", short_name: "Midea 24K INV", locked_sell_ex_vat: 15000, locked_cost_ex_vat: 10000, manual_price_override: true };
    const out = applyCategoryRatesToBaskets([{ id: "a", name: "A", items: [{ instanceId: "1", quantity: 1, product: manual }] }] as any, { units: 30, materials: 80 });
    expect(out[0].items[0].product.locked_sell_ex_vat).toBe(15000);
    const areas: any = [{ id: "z", name: "Living", acUnits: [{ id: "u", product: manual, btu: 24000, quantity: 1 },
      { id: "u2", product: { ...manual, manual_price_override: false }, btu: 24000, quantity: 1 }], consumables: [], brackets: [], timeHours: 0, subtotal: 0,
      materials: [{ id: "k", product: { short_name: "kit", locked_sell_ex_vat: 493.38, locked_cost_ex_vat: 250 }, defaultLength: 2, adjustedLength: 2, costPerMeter: 493.38, totalCost: 986.76, pricingMode: "length", unitQuantity: 1,
        kit: { name: "24K kit", pricingType: "p/meter", unitSell: 493.38, unitCost: 250, items: [] } }] }];
    const r = applyCategoryRatesToAreas(areas, { units: 30, materials: 80 });
    expect(r[0].acUnits[0].product.locked_sell_ex_vat).toBe(15000);
    expect(r[0].acUnits[1].product.locked_sell_ex_vat).toBe(13000);
    expect(r[0].materials[0].kit!.unitSell).toBe(450);
    expect(r[0].materials[0].totalCost).toBe(900);
  });
});
