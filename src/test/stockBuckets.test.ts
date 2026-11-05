import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildPreview, lineVat, stockUnitSizeKey, withBucket, type Product } from "@/lib/stockReceive";

const unit: Product = { id: "u", product_code: "FCMI-24", name: "Test 24K", cost_price: 1000, product_type: "ac_unit" };
const gas: Product = { id: "g", product_code: "G005", name: "GAS - R410 DISP 11.3KG", cost_price: 2260, product_type: "consumable" };

describe("three buckets", () => {
  it("sizes a model the same way the SQL helper does", () => {
    expect(stockUnitSizeKey("FCMI-24-P")).toBe("24000");
    expect(stockUnitSizeKey("FCMI24X")).toBe("24000");
    expect(stockUnitSizeKey("AR12")).toBe("12000");
    expect(stockUnitSizeKey("AR40H12C1AMN")).toBe("12000");
    expect(stockUnitSizeKey("24000")).toBe("24000");
    expect(stockUnitSizeKey("24K")).toBe("24000");
    expect(stockUnitSizeKey("12M")).toBeNull();
    expect(stockUnitSizeKey("12KG")).toBeNull();
    expect(stockUnitSizeKey("15MTR")).toBeNull();
    expect(stockUnitSizeKey("FCMI-124")).toBeNull();
    expect(stockUnitSizeKey("")).toBeNull();
  });
  it("keeps VAT off the exclusive cost", () => {
    expect(lineVat(100, 2, 15)).toEqual({ vat_rate: 15, vat_amount: 30, line_excl: 200 });
    expect(lineVat(null, 1).vat_amount).toBeNull();
  });
  it("a unit without a job is general stock; materials cannot be reserved", () => {
    const [row] = buildPreview("supplier_invoice", [{ line_no: 1, description: "Indoor", model_number: "FCMI-24-P", qty: 1, unit_price_excl: 1100 }], [unit]);
    expect(row.bucket).toBe("general_unit");
    expect(row.adds_stock).toBe(true);
    const snapped = withBucket({ ...row, action: "reserve", job_id: "job-1" });
    expect(snapped).toMatchObject({ action: "reserve", bucket: "job_unit", job_id: "job-1" });
    const [mat] = buildPreview("supplier_invoice", [{ line_no: 1, description: "Gas", model_number: "G005", qty: 1, unit_price_excl: 2260 }], [gas], [], "job-1");
    expect(withBucket({ ...mat, action: "reserve", job_id: "job-1" })).toMatchObject({ action: "stock", bucket: "material_pool", job_id: null });
  });
});

describe("supplier cost stays off the tech job sheet", () => {
  it("serial confirm and finish-job do not read unit cost", () => {
    const serials = readFileSync("src/components/stock/TechUnitSerials.tsx", "utf8");
    const sheet = readFileSync("src/pages/FieldJobSheetPage.tsx", "utf8");
    const finish = readFileSync("src/components/jobs/JobCompletionSheet.tsx", "utf8");
    for (const src of [serials, sheet, finish]) {
      expect(src).not.toMatch(/unit_cost/);
      expect(src).not.toMatch(/vat_amount/);
    }
    expect(serials).toMatch(/job_units_for_tech/);
    expect(serials).toMatch(/job_confirm_unit_serial/);
    expect(finish).toMatch(/job_apply_material_allowances/);
  });
});
