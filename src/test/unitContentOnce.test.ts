import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { missingModelKeys } from "@/lib/unitCards";

describe("unit content reuse", () => {
  const line = { item_name: "Midea wall split", item_type: "unit", product_code: "MSAGD-24HRN1-QC0W", btu_rating: 24000 };
  it("only proposes missing models, deduplicated across rooms", () => {
    expect(missingModelKeys([line, line], [])).toEqual([line.product_code]);
    expect(missingModelKeys([line], [line.product_code])).toEqual([]);
  });
  it("runs from live builder lines, not just preview or PDF", () => {
    expect(readFileSync("src/components/quoting/EstimateBuilder.tsx", "utf8")).toContain("useQuoteUnitCards(contentLines, { ensure: true })");
  });
  it("server skips saved models and claims unknown models before search", () => {
    const src = readFileSync("supabase/functions/lookup-ac-unit-specs/index.ts", "utf8");
    expect(src).toContain("keys.filter((k) => !have.has(k))");
    expect(src.indexOf('fetch_error: "fetching…"')).toBeLessThan(src.indexOf("const row = await fetchModelContent"));
  });
});