import { describe, it, expect } from "vitest";
import { resolveBundleItem, notFoundProduct, normCode } from "@/lib/bundleResolve";
import { r0Quote } from "@/lib/zeroPriceGuard";

const live = [
  { id: "a", product_code: "COP-001", supplier_id: "s2" },
  { id: "b", product_code: "cop001", supplier_id: "s1" },
];

describe("bundle model-number resolver", () => {
  it("normalises codes", () => expect(normCode(" Cop-00 1 ")).toBe("cop001"));
  it("prefers the same supplier", () => {
    expect(resolveBundleItem({ model_number: "COP 001", supplier_id: "s1" }, live as any)?.id).toBe("b");
    expect(resolveBundleItem({ model_number: "COP001", supplier_id: "x" }, live as any)?.id).toBe("a");
  });
  it("returns null when not on the list", () => expect(resolveBundleItem({ model_number: "COP002" }, live as any)).toBeNull());
  it("placeholder is zero priced and named for remap", () => {
    const p = notFoundProduct("COP002", "old");
    expect(p.cost_excl_vat).toBe(0);
    expect(p.short_name).toBe("Not found: COP002 – remap");
  });
  it("blocks send for a not-found kit item", () => {
    const lines = [{ item_name: "Kit", unit_price: 500, metadata: { kit: { items: [{ name: "Not found: COP002 – remap" }] } } }];
    expect(r0Quote(lines)).toBe("Not found: COP002 – remap");
    expect(r0Quote([{ item_name: "Kit", unit_price: 500, metadata: { kit: { items: [{ name: "Copper" }] } } }])).toBeNull();
  });
});
