import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("dormant trigger record access", () => {
  it("company create, active writes, and archived payment guards pass on a database", () => {
    execFileSync("node", ["supabase/tests/dormant_company/run.mjs"], { stdio: "inherit" });
  });
});
