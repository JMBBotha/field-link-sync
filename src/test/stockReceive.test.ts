import { describe, it, expect } from "vitest";
import { normaliseModel, stockKey, matchProduct, priceCheck, buildPreview, toReceivePayload, canConfirm, type Product } from "@/lib/stockReceive";
import { buildDrawPlan, toDrawPayload } from "@/lib/materialsDrawdown";

const products: Product[] = [
  { id: "p-fcmi12", product_code: "FCMI-12", name: "Test Inverter 12K", cost_price: 5425.39, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-fcmi24", product_code: "FCMI-24", name: "Test Inverter 24K", cost_price: 10434.09, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-fcmf24", product_code: "FCMF-24", name: "Test Fixed 24K", cost_price: 9000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-gas", product_code: "G005", name: "GAS - R410 DISP 11.3KG", cost_price: 2260, product_type: "consumable", price_per_unit_label: "each" },
  { id: "p-cu", product_code: "COPRL001", name: "Soft Drawn Copper 1/4 Inch 15.24 mtr", cost_price: 60, product_type: "consumable", price_per_unit_label: "m", sold_in_length: true, unit_length: 15.24 },
];

describe("model codes", () => {
  it("catalogue key joins indoor/outdoor and suffixes; stock key keeps them apart", () => {
    expect(normaliseModel("FCMI-24-P")).toBe("FCMI24");
    expect(normaliseModel("FCMI-24X-P")).toBe("FCMI24");
    expect(normaliseModel("FCMI-L-12X")).toBe("FCMIL12");
    expect(stockKey("FCMI-24-P")).toBe("FCMI24");
    expect(stockKey("FCMI-24X-P")).toBe("FCMI24X");
  });
  it("matches by normalised code and flags FCMF look-alike without matching it", () => {
    const m = matchProduct("FCMI-24X-P", products);
    expect(m.product?.id).toBe("p-fcmi24");
    expect(m.how).toBe("normalised");
    expect(m.lookalikes.map((p) => p.product_code)).toEqual(["FCMF-24"]);
    expect(matchProduct("FCMZ-24", products).product).toBeNull();
    const lite = matchProduct("FCMI-L-12", products);
    expect(lite.product).toBeNull();
    expect(lite.lookalikes.map((p) => p.product_code)).toEqual(["FCMI-12"]);
  });
});

describe("price check", () => {
  it("warns when higher, notes when lower, quiet when equal", () => {
    expect(priceCheck(110, 100).level).toBe("warn");
    expect(priceCheck(90, 100).level).toBe("note");
    expect(priceCheck(100.2, 100).level).toBe("none");
    expect(priceCheck(null, 100).level).toBe("none");
  });
});

describe("buildPreview", () => {
  const lines = [
    { line_no: 1, description: "Indoor 24K", model_number: "FCMI-24-P", qty: 1, unit_price_excl: null },
    { line_no: 2, description: "Outdoor 24K", model_number: "FCMI-24X-P", qty: 1, unit_price_excl: null },
    { line_no: 3, description: "R410 gas", model_number: "G005", qty: 2, unit_price_excl: null },
  ];
  it("delivery note: catalogue cost, no stock added, units can be reserved for a job", () => {
    const rows = buildPreview("delivery_note", lines, products, [], "job-test-1");
    expect(rows[0]).toMatchObject({ action: "reserve", job_id: "job-test-1", cost_source: "catalogue", adds_stock: false, unit_cost_pack: 10434.09 });
    expect(rows[0].stock_key).not.toBe(rows[1].stock_key);
    expect(rows[2]).toMatchObject({ action: "stock", stock_qty: 22.6, cost_per_stock_unit: 200, adds_stock: false });
    expect(rows[2].notes.join()).toMatch(/invoice/);
  });
  it("invoice: adds stock at invoice price, inherits job from the delivery note, flags price change", () => {
    const inv = lines.map((l, i) => ({ ...l, unit_price_excl: [11000, 10000, 2260][i] }));
    const earlier = [
      { product_id: "p-fcmi24", normalised: "FCMI24", unit_cost_excl: 10434.09, receive_action: "reserve", receive_job_id: "job-test-2" },
    ];
    const rows = buildPreview("supplier_invoice", inv, products, earlier);
    expect(rows[0]).toMatchObject({ action: "reserve", job_id: "job-test-2", cost_source: "invoice", adds_stock: true });
    expect(rows[0].price.level).toBe("warn");
    expect(rows[1].price.level).toBe("note");
    expect(rows[2].price.level).toBe("none");
    expect(canConfirm(rows)).toBe(true);
    const payload = toReceivePayload(rows, { 1: "l1", 2: "l2", 3: "l3" });
    expect(payload[0]).toMatchObject({ line_id: "l1", action: "reserve", job_id: "job-test-2", model_code: "FCMI24", unit_cost_pack: 11000, price_flag: "warn" });
    expect(payload[2]).toMatchObject({ stock_unit: "kg", pack_size: 11.3, qty_packs: 2 });
  });
  it("cannot confirm a reserve without a job", () => {
    const rows = buildPreview("delivery_note", lines.slice(0, 1), products);
    rows[0].action = "reserve";
    expect(canConfirm(rows)).toBe(false);
  });
});

describe("materials draw plan", () => {
  const stock = [
    { id: "s-cu", product_id: "p-cu", item: "Copper 1/4", qty_on_hand: 30.48, stock_unit: "m" as const, pack_size: 15.24 },
    { id: "s-gas", product_id: "p-gas", item: "R410a", qty_on_hand: 11.3, stock_unit: "kg" as const, pack_size: 11.3 },
    { id: "s-unit", product_id: "p-fcmi24", item: "FCMI24", qty_on_hand: 1, stock_unit: "each" as const, pack_size: 1 },
  ];
  const items = [
    { quote_item_id: "q1", product_id: "p-cu", item_name: "Copper", quantity: 6, product: products[4] },
    { quote_item_id: "q2", product_id: "p-gas", item_name: "Gas", quantity: 1, product: products[3] },
    { quote_item_id: "q3", product_id: null, item_name: "Labour", quantity: 1, product: null },
    { quote_item_id: "q4", product_id: "p-fcmi24", item_name: "Unit", quantity: 1, product: { ...products[1], name: "Test Inverter 24K" } },
  ];
  it("quote metres, pack conversions, already drawn, reserved units", () => {
    const rows = buildDrawPlan(items, stock, [{ stock_item_id: "s-cu", drawn_qty: 2 }], [{ stock_item_id: "s-unit", qty: 1 }]);
    expect(rows.find((r) => r.key === "q1")).toMatchObject({ quoted: 6, already: 2, suggested: 4, unit: "m" });
    expect(rows.find((r) => r.key === "q2")).toMatchObject({ suggested: 11.3, unit: "kg" });
    expect(rows.find((r) => r.key === "q3")).toMatchObject({ stock_item_id: null });
    expect(rows.find((r) => r.key === "q4")).toMatchObject({ reserved: true, suggested: 0 });
    const pay = toDrawPayload(rows, { q2: 1.4 });
    expect(pay).toEqual([{ stock_item_id: "s-cu", quote_item_id: "q1", qty: 4 }, { stock_item_id: "s-gas", quote_item_id: "q2", qty: 1.4 }]);
  });
});
