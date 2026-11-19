import { describe, it, expect } from "vitest";
import { isReadonlyRoleSet, isSalesRep, roleCanView } from "./roleAccess";

describe("isSalesRep", () => {
  it("admin+sales -> false", () => expect(isSalesRep(["admin", "dispatcher"], "sales")).toBe(false));
  it("dispatcher+sales -> true", () => expect(isSalesRep(["dispatcher"], "sales")).toBe(true));
  it("dispatcher+sales_engineer -> true", () => expect(isSalesRep(["dispatcher"], "sales_engineer")).toBe(true));
  it("dispatcher+null -> false", () => expect(isSalesRep(["dispatcher"], null)).toBe(false));
  it("field_agent+sales -> false", () => expect(isSalesRep(["field_agent"], "sales")).toBe(false));
});

describe("view-only designer", () => {
  it("viewer alone is read-only and can open admin, sales, and tech screens", () => {
    expect(isReadonlyRoleSet(["viewer"])).toBe(true);
    expect(isReadonlyRoleSet(["viewer", "admin"])).toBe(false);
    expect(isReadonlyRoleSet(["admin"])).toBe(false);
    expect(roleCanView(["viewer"], ["admin"], {})).toBe(true);
    expect(roleCanView(["viewer"], ["field_agent", "admin", "dispatcher"], {})).toBe(true);
    expect(roleCanView(["viewer"], ["admin"], { denyViewer: true })).toBe(false);
    expect(roleCanView(["dispatcher"], ["admin"], { denySalesRep: true, isSalesRep: true })).toBe(false);
    expect(roleCanView(["admin"], ["admin"], {})).toBe(true);
    expect(roleCanView(["field_agent"], ["admin"], {})).toBe(false);
  });
});
