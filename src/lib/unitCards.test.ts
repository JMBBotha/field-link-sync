import { describe, it, expect } from "vitest";
import { buildUnitCards, missingModelKeys, normalizeModelCode, primaryModelCode, specChips, unitLineModelKey } from "./unitCards";

const ar70 = { item_name: "AR70 WindFree 12000 BTU", item_type: "product", product_code: "AR70F12C1FW/FA", btu_rating: 12000, category: "Air Conditioners", brand: "Samsung", quantity: 1, area_name: "Main bedroom" };

describe("unit cards", () => {
  it("normalises like the DB", () => {
    expect(normalizeModelCode(" ar70f12c1fw/fa ")).toBe("AR70F12C1FW/FA");
    expect(normalizeModelCode("FFA60A9 (X2)-DUP2")).toBe("FFA60A9(X2)");
    expect(primaryModelCode("FFA25A9 (X2) + FFA60A9-DUP3")).toBe("FFA25A9");
  });
  it("gives AC units a key and never fans, materials or labour", () => {
    expect(unitLineModelKey(ar70)).toBe("AR70F12C1FW/FA");
    expect(unitLineModelKey({ item_name: "Labour: 2 hours at R680/hour", item_type: "labour", quantity: 2 })).toBeNull();
    expect(unitLineModelKey({ item_name: "Bathroom extraction system: 1 x TD100 silent fan", item_type: "service" })).toBeNull();
    expect(unitLineModelKey({ item_name: "100mm spiral ducting", item_type: "material", product_code: "DUCT100" })).toBeNull();
    expect(unitLineModelKey({ item_name: "Wireless remote controller BRC4C65", item_type: "product", product_code: "BRC4C65" })).toBeNull();
  });
  it("dedupes per model across rooms and sums qty", () => {
    const cards = buildUnitCards([ar70, { ...ar70, area_name: "Bedroom 2", quantity: 2 }, { ...ar70, area_name: "Main bedroom" }], new Map());
    expect(cards).toHaveLength(1);
    expect(cards[0].quantity).toBe(4);
    expect(cards[0].rooms).toEqual(["Main bedroom", "Bedroom 2"]);
    expect(cards[0].media).toBeNull();
  });
  it("uses approved media only; drafts fall back", () => {
    const m = { model_key: "AR70F12C1FW/FA", model_code: "AR70F12C1FW/FA", display_name: "Samsung AR70", status: "draft" as const };
    expect(buildUnitCards([ar70], { "AR70F12C1FW/FA": m })[0].media).toBeNull();
    expect(buildUnitCards([ar70], { "AR70F12C1FW/FA": { ...m, status: "approved" } })[0].media?.display_name).toBe("Samsung AR70");
  });
  it("lists missing keys once", () => {
    expect(missingModelKeys([ar70, ar70], [])).toEqual(["AR70F12C1FW/FA"]);
    expect(missingModelKeys([ar70], ["AR70F12C1FW/FA"])).toEqual([]);
  });
  it("builds spec chips and a catalogue fallback", () => {
    expect(specChips({ cool_kw: 3.5, heat_kw: 3.8, eer: 3.21, cop: 3.41, noise_in_db: "38/22", refrigerant: "R32", wifi: true })).toEqual(["3.5 kW cool", "3.8 kW heat", "EER 3.21 · COP 3.41", "38/22 dBA indoor", "R32", "Wi-Fi"]);
    expect(specChips(null, { btu: 9000, refrigerant: "R410A" })).toEqual(["9,000 BTU/h", "R410A"]);
  });
});
