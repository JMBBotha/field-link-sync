import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CLIENT_CALL_OUT } from "./jobTypeChoice";

describe("shared email signature", () => {
  it("browser and edge copies are identical so every email matches", () => {
    const a = readFileSync("src/lib/emailSignature.ts", "utf8");
    const b = readFileSync("supabase/functions/_shared/emailSignature.ts", "utf8");
    expect(a).toBe(b);
  });
});

describe("client call-out wording", () => {
  it("is the short client line only", () => {
    expect(CLIENT_CALL_OUT).toBe("Call-out fee: R680 excl. VAT");
  });
  it("client templates never carry the internal rule", () => {
    for (const f of ["supabase/migrations/20261103150000_client_callout_wording.sql", "supabase/functions/_shared/appointmentConfirmation.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/never deducted|charged separately/i);
    }
  });
});
