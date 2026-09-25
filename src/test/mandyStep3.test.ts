import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(), rpc: vi.fn() } }));
import { resolveSpokenDate } from "@/lib/mandy/dates";
import { gateRoute, MANDY_MIN_CONFIDENCE } from "@/lib/mandy/router";
import { makeDepositHandlers } from "@/lib/mandy/depositActions";
import { mapSpokenStatus } from "@/lib/mandy/mapStatus";
import { CONFIRM_REQUIRED } from "@/lib/mandy/actions";

// Friday 2026-09-25 23:30 UTC = Saturday 26 Sep 01:30 in Johannesburg.
const lateFri = new Date("2026-09-25T23:30:00Z");
const midFri = new Date("2026-09-25T10:00:00Z");

describe("resolveSpokenDate (Africa/Johannesburg)", () => {
  it("today / tomorrow follow SAST, not UTC", () => {
    expect(resolveSpokenDate("today", midFri)).toBe("2026-09-25");
    expect(resolveSpokenDate("tomorrow", midFri)).toBe("2026-09-26");
    expect(resolveSpokenDate("today", lateFri)).toBe("2026-09-26");
  });
  it("weekday = next occurrence", () => {
    expect(resolveSpokenDate("Monday", midFri)).toBe("2026-09-28");
    expect(resolveSpokenDate("Friday", midFri)).toBe("2026-10-02");
    expect(resolveSpokenDate("on saturday", midFri)).toBe("2026-09-26");
  });
  it("day + month", () => {
    expect(resolveSpokenDate("3 October", midFri)).toBe("2026-10-03");
    expect(resolveSpokenDate("October 3rd", midFri)).toBe("2026-10-03");
    expect(resolveSpokenDate("1 January", midFri)).toBe("2027-01-01");
    expect(resolveSpokenDate("gibberish", midFri)).toBeNull();
  });
});

describe("confidence gate", () => {
  it("0.69 → no execution, one chip + question", () => {
    const g = gateRoute({ action: "open_invoice", args: { ref: "INV-12" }, confidence: 0.69 });
    expect(g.run).toBe(false);
    expect(g.choice).toEqual({ label: "Yes — open invoice: INV-12", action: "open_invoice", args: { ref: "INV-12" } });
    expect(g.question).toMatch(/Did you mean/);
  });
  it("at threshold runs", () => {
    expect(MANDY_MIN_CONFIDENCE).toBe(0.7);
    expect(gateRoute({ action: "open_live_map", args: {}, confidence: 0.7 }).run).toBe(true);
  });
});

describe("create_deposit_invoice", () => {
  const quote = { id: "q1", quote_number: "Q-2026-0100", status: "accepted", total: 20000 };
  const deps = (over = {}) => ({
    resolveQuote: vi.fn(async () => quote),
    fetchInvoice: vi.fn(async () => null),
    depositPercent: vi.fn(async () => 70),
    ensureDeposit: vi.fn(async () => "inv1"),
    ...over,
  });

  it("is on the confirm-required list", () => expect(CONFIRM_REQUIRED.has("create_deposit_invoice")).toBe(true));

  it("never calls ensureDeposit until confirm.run()", async () => {
    const d = deps();
    const r = await makeDepositHandlers(d).create_deposit_invoice({});
    expect(d.ensureDeposit).not.toHaveBeenCalled();
    expect(r.confirm?.summary).toBe("Create deposit invoice of R14 000.00 for Q-2026-0100?");
    const done = await r.confirm!.run();
    expect(d.ensureDeposit).toHaveBeenCalledWith("q1");
    expect(done.ok).toBe(true);
  });

  it("not accepted / already exists → does nothing, no confirm", async () => {
    const d1 = deps({ resolveQuote: vi.fn(async () => ({ ...quote, status: "sent" })) });
    const r1 = await makeDepositHandlers(d1).create_deposit_invoice({});
    expect(r1.confirm).toBeUndefined();
    const d2 = deps({ fetchInvoice: vi.fn(async () => ({ id: "x", grand_total: 1 })) });
    const r2 = await makeDepositHandlers(d2).create_deposit_invoice({});
    expect(r2.confirm).toBeUndefined();
    expect(d1.ensureDeposit).not.toHaveBeenCalled();
    expect(d2.ensureDeposit).not.toHaveBeenCalled();
  });
});

describe("map status words", () => {
  it("maps spoken words, rejects non-statuses", () => {
    expect(mapSpokenStatus("pending")).toBe("pending");
    expect(mapSpokenStatus("in progress")).toBe("in_progress");
    expect(mapSpokenStatus("completed")).toBe("completed");
    expect(mapSpokenStatus("emergency")).toBeNull();
  });
});
