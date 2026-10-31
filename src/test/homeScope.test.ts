import { describe, expect, it } from "vitest";
import { homeScope, quoteInScope } from "@/lib/homeScope";
describe("home flow scope", () => {
  it("linked sales login counts company-wide", () => { expect(homeScope("sales", "admin-1")).toBe("company"); });
  it("plain rep counts own", () => { expect(homeScope("sales", null)).toBe("own"); });
  it("owner/admin company-wide", () => { expect(homeScope("owner", null)).toBe("company"); expect(homeScope("admin", undefined)).toBe("company"); });
  it("filters quotes", () => {
    expect(quoteInScope({ sales_engineer_id: "admin-1" }, "own", "rep-1")).toBe(false);
    expect(quoteInScope({ sales_engineer_id: "rep-1" }, "own", "rep-1")).toBe(true);
    expect(quoteInScope({ sales_engineer_id: "admin-1" }, "company", "rep-1")).toBe(true);
  });
});
