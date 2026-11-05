import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("company history reader", () => {
  it("returns only the requested company's invoices, lines and payments", () => {
    execFileSync("node", ["supabase/tests/company_history/run.mjs"], { stdio: "inherit" });
  });
});
