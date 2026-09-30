import { describe, it, expect } from "vitest";
import { isSalesRep } from "./roleAccess";

describe("isSalesRep", () => {
  it("admin+sales -> false", () => expect(isSalesRep(["admin", "dispatcher"], "sales")).toBe(false));
  it("dispatcher+sales -> true", () => expect(isSalesRep(["dispatcher"], "sales")).toBe(true));
  it("dispatcher+sales_engineer -> true", () => expect(isSalesRep(["dispatcher"], "sales_engineer")).toBe(true));
  it("dispatcher+null -> false", () => expect(isSalesRep(["dispatcher"], null)).toBe(false));
  it("field_agent+sales -> false", () => expect(isSalesRep(["field_agent"], "sales")).toBe(false));
});
