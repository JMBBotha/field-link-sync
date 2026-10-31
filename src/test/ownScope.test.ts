import { describe, it, expect } from "vitest";
import { ownScopeOnly } from "@/lib/homeScope";
describe("ownScopeOnly (linked-admin rule)", () => {
  it("plain sales rep = own records", () => expect(ownScopeOnly(true, null)).toBe(true));
  it("sales login linked to an admin = company scope", () => expect(ownScopeOnly(true, "admin-1")).toBe(false));
  it("non-rep = company scope", () => expect(ownScopeOnly(false, null)).toBe(false));
});
