import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("company list column grant", () => {
  it("fails the real select until the lock column is granted, then returns active and archived", () => {
    execFileSync("node", ["supabase/tests/company_list/run.mjs"], { stdio: "inherit" });
  });
});
