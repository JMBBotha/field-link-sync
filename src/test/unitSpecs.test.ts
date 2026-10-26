import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { specChips, dimensionSpecRows } from "@/lib/unitCards";

const sql = readFileSync("supabase/migrations/20261026160000_unit_specs_samsung.sql", "utf8");

describe("step 2 Samsung specs", () => {
  it("does not change status and backs up specs", () => {
    expect(sql).not.toMatch(/status\s*=/i);
    expect(sql).toMatch(/product_media_specs_backup_20261026/);
  });
  it("nulls the unverified AJ052TN1DKH card keys instead of guessing", () => {
    const line = sql.split("\n").find((l) => l.includes("'AJ052TN1DKH/EA';"))!;
    expect(line).toContain('"cool_kw": null');
    expect(line).toContain('"indoor_dim_mm": null');
  });
  it("labels outdoor-only noise as outdoor", () => {
    const chips = specChips({ cool_kw: 14, heat_kw: 15, eer: 2.89, cop: 3.5, noise_in_db: null, noise_out_db: 52, refrigerant: "R410A" });
    expect(chips).toContain("52 dBA outdoor");
    expect(chips.join()).not.toContain("indoor");
  });
  it("shows outdoor dims for FJM outdoor units", () => {
    expect(dimensionSpecRows({ outdoor_dim_mm: "940 x 1210 x 330", outdoor_net_kg: 87.5 })).toEqual([
      ["Outdoor unit, net size (W × H × D)", "940 × 1210 × 330 mm"],
      ["Outdoor unit, net weight", "87.5 kg"],
    ]);
  });
});
