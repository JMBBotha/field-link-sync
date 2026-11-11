import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("cancel_booking_visit", () => {
  it("clears the schedule and leaves quotes and invoices alone", () => {
    const out = execFileSync("node", ["supabase/tests/cancel_booking_visit/run.mjs"], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(out).toContain("cancel_booking_visit ok");
    expect(out).not.toContain("FAIL");
  }, 60000);

  it("ships a manual rollback that restores the previous function bodies", () => {
    const down = readFileSync("supabase/manual/20261111170000_cancel_booking_visit_rollback.sql", "utf8");
    expect(down.split("\n")[0]).toBe("-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION");
    expect(down).toContain("DROP FUNCTION IF EXISTS public.cancel_booking_visit(uuid, text, text, uuid)");
    expect(down).toContain("DROP FUNCTION IF EXISTS public.set_quote_group_salesperson(uuid, uuid)");
    expect(down).toContain("jsonb_array_length(p_visits) = 0");
    expect(down).not.toContain("cancel_booking_visit(p_lead");
    const up = readFileSync("supabase/migrations/20261111170000_cancel_booking_visit.sql", "utf8");
    expect(up.split("\n")[0]).not.toMatch(/rollback|DO NOT RUN AS MIGRATION/i);
  });
});
