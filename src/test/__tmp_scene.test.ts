import { describe, it, expect } from "vitest";
import { parseScene, buildSceneBreakdown, normalizeScene } from "@/lib/voiceQuoteKit";

const mk = (o: any) => ({ id: o.code, product_code: o.code, short_name: o.name, brand: o.brand || "ONE STOP", product_category: "", category: "", cost_excl_vat: o.cost ?? 100, cost_incl_vat: 0, cost_price: 0, selling_price: 0, default_markup_percent: 25, description: "", is_pinned: false, pin_order: null, supplier_name: o.brand || "ONE STOP", supplier_type: "", price_per_metre: o.pm ?? null, sold_in_length: !!o.pm, unit_length: o.len ?? null, pipe_size: null, is_material_favorite: false, pack_qty: null, btu_rating: o.btu ?? null, supplier_discount_percent: null, markup_percent: null, search_aliases: o.al || [] });
const products = [
  mk({ code: "COPRL001", name: "Copper 1/4", pm: 50, len: 15 }), mk({ code: "IT009", name: "Armaflex 1/4", pm: 10, len: 2 }),
  mk({ code: "COPRL003", name: "Copper 1/2", pm: 80, len: 15 }), mk({ code: "IT011", name: "Armaflex 1/2", pm: 12, len: 2 }),
  mk({ code: "DPIPE01", name: "PVC Pipe 20mm x 4mtr", pm: 7, len: 4, al: ["drain pipe", "pvc pipe"] }),
  mk({ code: "ELB001", name: "PVC Elbow 20mm", al: ["elbow", "drain elbow"] }),
  mk({ code: "AR40F18C0AG/FA", name: "Samsung 18K INV MW", brand: "Samsung", btu: 18000, cost: 9000 }),
  mk({ code: "AR18BSHGAWK/FA", name: "Samsung 18K INV MW", brand: "Samsung", btu: 18000, cost: 8000 }),
  mk({ code: "AR12BSHGAWK/FA", name: "Samsung 12K INV MW", brand: "Samsung", btu: 12000, cost: 6000 }),
  mk({ code: "LG12X", name: "LG 12K INV MW", brand: "LG", btu: 12000, cost: 6000 }),
];
const services = [
  { id: "s18", name: "Split Unit Installation - 18kW", category: "installation", default_price: 15500, unit: "each" },
  { id: "s12", name: "Split Unit Installation - 12kW", category: "installation", default_price: 11000, unit: "each" },
  { id: "s9", name: "Split Unit Installation - 9kW", category: "installation", default_price: 8500, unit: "each" },
];
const SCENE = "Main bedroom 18,000 BTU, AR 4500 Samsung. Outside wall so back-to-back installation, three metres of piping. Piping is quarter and half with lagging. Five metre drain pipe with three elbows. Labour approximately three hours.";

describe("scene", () => {
  it("normalizes", () => { expect(normalizeScene(SCENE)).toContain("18000 btu"); });
  it("parses example into one area", () => {
    const d = parseScene(SCENE);
    console.log(JSON.stringify(d, null, 1));
    expect(d.areas.length).toBe(1);
    expect(d.areas[0].name).toBe("Main bedroom");
    const t = d.areas[0].slots.map((s) => s.t);
    expect(t).toContain("unit"); expect(t).toContain("copper"); expect(t).toContain("drain"); expect(t).toContain("elbows"); expect(t).toContain("labour"); expect(t).toContain("note");
    const cop = d.areas[0].slots.find((s) => s.t === "copper") as any;
    expect(cop.c.sizes).toEqual(["1/4", "1/2"]); expect(cop.c.runM).toBe(3);
    const u = d.areas[0].slots.find((s) => s.t === "unit") as any;
    expect(u.u.btu).toBe(18000); expect(u.u.brand).toBe("samsung"); expect(u.u.model).toBe("AR4500");
  });
  it("builds breakdown with prices", () => {
    const bd = buildSceneBreakdown(SCENE, products as any, services);
    const a = bd.areas[0];
    console.log(a.notes, a.lines.map((l) => [l.status, l.quantity, l.unitLabel, l.label, l.unitPrice, l.hint, l.productCandidates?.map((p: any) => p.product_code)]));
    expect(a.lines.filter((l) => l.meta.kit === "copper").map((l) => l.quantity)).toEqual([3.3, 3.3, 3.3, 3.3]);
    expect(a.lines.find((l) => l.meta.drain)!.quantity).toBe(5);
    expect(a.lines.find((l) => l.meta.elbows)!.quantity).toBe(3);
    expect(a.lines.find((l) => l.meta.labour)!.service!.id).toBe("s18");
    expect(a.lines[0].meta.unit).toBe(true);
    expect(a.lines[0].product!.product_code).toBe("AR40F18C0AG/FA");
  });
  it("two rooms", () => {
    const bd = buildSceneBreakdown(SCENE + " Lounge 12000 BTU LG inverter, 4 metres quarter copper, 2 hours labour.", products as any, services);
    console.log(bd.areas.map((a) => [a.name, a.lines.map((l) => `${l.status}:${l.label}`)]));
    expect(bd.areas.map((a) => a.name)).toEqual(["Main bedroom", "Lounge"]);
    const l = bd.areas[1];
    expect(l.lines[0].product!.product_code).toBe("LG12X");
    expect(l.lines.find((x) => x.meta.labour)!.service!.id).toBe("s12");
  });
  it("incomplete copper stays on card", () => {
    const bd = buildSceneBreakdown("Kitchen 9000 btu, some copper piping, 3 elbows", products as any, services);
    const k = bd.areas[0];
    expect(k.lines.find((l) => l.meta.kit_pending)!.status).toBe("incomplete");
  });
});
