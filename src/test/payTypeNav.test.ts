import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { v8Primary, v8Tabs } from "@/components/v8/v8Nav";

describe("salaried techs see no earnings", () => {
  it("v8 tech nav drops Earnings for salary only", () => {
    expect(v8Primary("tech").map((l) => l.path)).toContain("/field/earnings");
    expect(v8Primary("tech", { salary: true }).map((l) => l.path)).not.toContain("/field/earnings");
    expect(v8Tabs("tech", { salary: true }).map((l) => l.path)).not.toContain("/field/earnings");
  });
  it("migration blocks ledger rows and earnings RPC for salary", () => {
    const sql = readFileSync("supabase/migrations/20261028190000_staff_pay_type.sql", "utf8");
    expect(sql).toMatch(/BEFORE INSERT ON public\.tech_earnings_ledger/);
    expect(sql).toMatch(/pay_type = 'salary'\) THEN RETURN; END IF;/);
    expect(sql).toMatch(/Only an admin can change pay type/);
  });
});
