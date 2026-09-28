import { describe, it, expect } from "vitest";
import {
  canMarkQuote, canChangeSalesperson, snapshotOf, buildAcceptPatch, buildDeclinePatch,
  buildStatusUndoPatch, buildSalespersonPatch, buildLogRow,
} from "@/lib/quoteStaffActions";

const now = new Date("2026-09-28T12:00:00Z");
const q = { id: "q1", company_id: "c1", sales_engineer_id: "rep", created_by: "x", owner_id: null };

describe("patches", () => {
  it("accept sets status, time and staff name, never a signature", () => {
    const p = buildAcceptPatch("Johan Botha", now);
    expect(p).toEqual({ status: "accepted", accepted_at: now.toISOString(), accepted_by: "staff:Johan Botha" });
    expect("accepted_signature" in p).toBe(false);
  });
  it("decline sets status + declined_at", () => {
    expect(buildDeclinePatch(now)).toEqual({ status: "declined", declined_at: now.toISOString() });
  });
  it("undo restores previous status + timestamps exactly", () => {
    const prev = snapshotOf({ status: "sent", accepted_at: null, accepted_by: null, declined_at: null });
    expect(buildStatusUndoPatch(prev)).toEqual({ status: "sent", accepted_at: null, accepted_by: null, declined_at: null });
  });
  it("salesperson patch only touches sales_engineer_id", () => {
    expect(buildSalespersonPatch("u2")).toEqual({ sales_engineer_id: "u2" });
  });
  it("log row shape", () => {
    expect(buildLogRow(q, "sales_engineer_id", "rep", "u2", "me")).toEqual({
      entity_type: "quote", entity_id: "q1", field_name: "sales_engineer_id", old_status: "rep", new_status: "u2", changed_by: "me", company_id: "c1",
    });
  });
});

describe("permissions", () => {
  it("field agent can't mark or change salesperson", () => {
    const a = { userId: "fa", roles: ["field_agent"], dispatchRole: null };
    expect(canMarkQuote(a, { ...q, sales_engineer_id: "fa" })).toBe(false);
    expect(canChangeSalesperson(a)).toBe(false);
  });
  it("admin + office can do both", () => {
    expect(canMarkQuote({ userId: "a", roles: ["admin", "field_agent"], dispatchRole: null }, q)).toBe(true);
    const office = { userId: "o", roles: ["dispatcher"], dispatchRole: null };
    expect(canMarkQuote(office, q)).toBe(true);
    expect(canChangeSalesperson(office)).toBe(true);
  });
  it("sales rep marks own quote only and can't change salesperson", () => {
    const rep = { userId: "rep", roles: ["dispatcher"], dispatchRole: "sales" };
    expect(canMarkQuote(rep, q)).toBe(true);
    expect(canMarkQuote(rep, { ...q, sales_engineer_id: "other" })).toBe(false);
    expect(canChangeSalesperson(rep)).toBe(false);
  });
});
