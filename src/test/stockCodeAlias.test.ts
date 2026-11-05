import { describe, it, expect } from "vitest";
import { matchProduct, buildPreview, samsungHalf, type Product, type CodeAlias } from "@/lib/stockReceive";
import { buildRecon, halfOf } from "@/lib/stockRecon";

const products: Product[] = [
  { id: "p-ar12", product_code: "AR40F12C0AG/FA", name: "Test AR40 12K", cost_price: 8000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-ar18", product_code: "AR40F18C0AG/FA", name: "Test AR40 18K", cost_price: 11000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-wf24", product_code: "AR24BSHCMWK/FA", name: "Test WindFree 24K", cost_price: 15000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-fcmi24", product_code: "FCMI-24", name: "Test Inverter 24K", cost_price: 10000, product_type: "ac_unit", price_per_unit_label: "each" },
  { id: "p-b1", product_code: "BRAC01", name: "Bracket 450", cost_price: 210, product_type: "consumable", price_per_unit_label: "each" },
];
const aliases: CodeAlias[] = [
  { product_id: "p-ar12", supplier_code: "AR40H12C1AMN", half: "indoor" }, { product_id: "p-ar12", supplier_code: "AR40H12C1AMX", half: "outdoor" },
  { product_id: "p-ar18", supplier_code: "AR40H18C1AMX", half: "outdoor" },
  { product_id: "p-wf24", supplier_code: "AR24BSHCMWKN", half: "indoor" }, { product_id: "p-wf24", supplier_code: "AR24BSHCMWKX", half: "outdoor" },
];
const L = (model_number: string, qty: number, line_no = 1) => ({ line_no, description: model_number, model_number, qty, unit_price_excl: null });

describe("Supplier code aliases", () => {
  it("maps aliased supplier codes to the catalogue item and flags it", () => {
    expect(matchProduct("AR40H12C1AMN", products, aliases)).toMatchObject({ how: "alias", product: { id: "p-ar12" } });
    expect(matchProduct("AR40H18C1AMX", products, aliases).product?.id).toBe("p-ar18");
    expect(matchProduct("AR24BSHCMWK-X", products, aliases).product?.id).toBe("p-wf24");
  });
  it("prefers exact/normalised matches and leaves unknown codes unmatched", () => {
    expect(matchProduct("AR40F12C0AG/FA", products, aliases).how).toBe("exact");
    expect(matchProduct("AR40H24C1AMN", products, aliases).how).toBe("none");
    expect(matchProduct("AR40H12C1AMN", products).how).toBe("none");
    expect(matchProduct("AR40H12C1AMN", products.filter((p) => p.id !== "p-ar12"), aliases).how).toBe("none");
  });
  it("reads Samsung N/X halves without breaking FCMI-24X", () => {
    expect(samsungHalf("AR40H12C1AMN")).toBe("indoor");
    expect(samsungHalf("AR24BSHCMWKX")).toBe("outdoor");
    expect(samsungHalf("FCMI-24X")).toBeNull();
    const rows = buildPreview("delivery_note", [L("AR40H12C1AMN", 1, 1), L("AR40H12C1AMX", 1, 2), L("FCMI-24", 1, 3), L("FCMI-24X", 1, 4)], products, [], null, aliases);
    expect(rows.map(halfOf)).toEqual(["indoor", "outdoor", "indoor", "outdoor"]);
  });
  it("pairs halves, splits pair cost and passes the reconciliation with a warning note", () => {
    const rows = buildPreview("delivery_note", [L("AR24BSHCMWKN", 2, 1), L("AR24BSHCMWKX", 2, 2), L("BRAC01", 2, 3)], products, [], null, aliases)
      .map((r) => (r.match.product?.product_type === "ac_unit" ? { ...r, action: "reserve" as const, job_id: "job-1" } : r));
    expect(rows[0].unit_cost_pack).toBe(7500);
    expect(rows[0].notes.some((n) => n.startsWith("Code alias"))).toBe(true);
    const r = buildRecon(rows, [{ id: "job-1", label: "Test job" }], []);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2 * 7500 * 2 + 2 * 210);
  });
});
