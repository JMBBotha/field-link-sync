import { describe, it, expect } from "vitest";
import { buildReviewItems, emptyPages, sampleCost, looseCode } from "./importReviewGate";

const ex = [
  { id: "1", product_code: "MIM-H04ΎN", cost_price: 500 },
  { id: "2", product_code: "MR<-A10N", cost_price: 300 },
  { id: "3", product_code: "AR09", cost_price: 1000 },
];

describe("import review gate", () => {
  it("flags OCR look-alike duplicates", () => {
    expect(looseCode("MR<-A10N")).toBe(looseCode("MRK-A10N"));
    const items = buildReviewItems([
      { model_number: "MRK-A10N", cost_price: 300 },
      { model_number: "MIM-H04*N", cost_price: 500 },
    ], ex);
    expect(items.map((i) => i.duplicateOf)).toEqual(["MR<-A10N", "MIM-H04ΎN"]);
  });
  it("flags zero cost and >30% change but not clean rows", () => {
    const items = buildReviewItems([
      { model_number: "AR09", cost_price: 1500 },
      { model_number: "AR12", cost_price: 0 },
      { model_number: "AR18", cost_price: 2000 },
    ], ex);
    expect(items.map((i) => i.index)).toEqual([0, 1]);
  });
  it("lists empty pages and computes sample cost", () => {
    expect(emptyPages([{ page: 1, rows: 3 }, { page: 2, rows: 0 }])).toEqual([2]);
    expect(sampleCost(2999.87, 20)).toBe(2399.9);
  });
});
