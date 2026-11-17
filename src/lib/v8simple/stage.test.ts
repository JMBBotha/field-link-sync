import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  V8_CALL_OUT_EXCL_VAT,
  V8_INSTALL_STAGES,
  callOutDoesNotReduce,
  v8MoneyLines,
  v8Stage,
} from "@/lib/v8simple/stage";

const label = (job: Parameters<typeof v8Stage>[0]) => v8Stage(job).label;

describe("v8Stage", () => {
  it("walks the install line in order", () => {
    expect(V8_INSTALL_STAGES.map((s) => s.label)).toEqual([
      "Lead", "Visit", "Quote sent", "Deposit due", "Ready to book", "On site", "Balance due", "Paid",
    ]);
    expect(label({})).toBe("Lead");
    expect(label({ visitBooked: true })).toBe("Visit");
    expect(label({ quoteStatus: "sent", quoteSentAt: "2026-11-01" })).toBe("Quote sent");
    expect(label({ quoteStatus: "accepted", depositPaid: false })).toBe("Deposit due");
    expect(label({ quoteStatus: "accepted", depositPaid: true })).toBe("Ready to book");
    expect(label({ quoteStatus: "accepted", depositPaid: true, techId: null })).toBe("Ready to book");
    expect(label({ quoteStatus: "accepted", depositPaid: true, depositRemaining: 0, techId: "tech-1" })).toBe("On site");
    expect(label({
      quoteStatus: "accepted", depositPaid: true, techId: "tech-1", completedAt: "2026-11-17", balanceRemaining: 4500,
    })).toBe("Balance due");
    expect(label({
      quoteStatus: "accepted", depositPaid: true, completedAt: "2026-11-17", balanceRemaining: 0, paid: true,
    })).toBe("Paid");
  });

  it("keeps an accepted quote with an unpaid deposit on Deposit due", () => {
    expect(v8Stage({ quoteStatus: "accepted", depositPaid: false, depositRemaining: 8000 }).key).toBe("deposit_due");
  });

  it("is Ready to book when the deposit is paid and no technician is assigned", () => {
    expect(v8Stage({ quoteStatus: "accepted", depositPaid: true, techId: null, depositRemaining: 0 }).key).toBe("ready");
  });

  it("is Balance due when the job is done and the balance is unpaid", () => {
    expect(v8Stage({
      quoteStatus: "accepted", depositPaid: true, completedAt: "2026-11-17T15:00:00+02:00", balanceRemaining: 2200,
    }).label).toBe("Balance due");
  });

  it("uses the service line for a call-out", () => {
    expect(v8Stage({ kind: "service" }).label).toBe("Booked");
    expect(v8Stage({ jobType: "repair", startedAt: "2026-11-17T09:00:00+02:00" }).label).toBe("On site");
    expect(v8Stage({ kind: "service", completedAt: "2026-11-17T11:00:00+02:00", payRemaining: 680 }).label).toBe("Pay due");
    expect(v8Stage({ kind: "service", completedAt: "2026-11-17T11:00:00+02:00", paid: true }).label).toBe("Paid");
  });

  it("leaves lost work off the active pills", () => {
    expect(v8Stage({ quoteStatus: "declined" }).active).toBe(false);
  });

  it("never lets a call-out reduce a quote, deposit, or balance", () => {
    const before = { quoteTotal: 10000, deposit: 7000, balance: 3000 };
    expect(V8_CALL_OUT_EXCL_VAT).toBe(680);
    expect(callOutDoesNotReduce(before, 680)).toBe(true);
    const after = v8MoneyLines({ ...before, callOutExclVat: 680 });
    expect(after).toEqual({ quoteTotal: 10000, deposit: 7000, balance: 3000, callOutExclVat: 680 });
    expect(after.quoteTotal).not.toBe(10000 - 680);
    expect(after.balance).not.toBe(3000 - 680);
    expect(v8Stage({ ...before, kind: "service", callOutExclVat: 680 }).label).toBe("Booked");
  });
});

describe("V8 simple has no PayFast", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return path.endsWith(".test.ts") || path.endsWith(".test.tsx") ? [] : [path];
    });
  }

  it("does not mention PayFast in the preview", () => {
    const roots = ["src/lib/v8simple", "src/components/v8simple", "src/pages/V8SimpleGate.tsx", "src/pages/V8SimpleRoutes.tsx"];
    const paths = roots.flatMap((root) => (statSync(root).isDirectory() ? files(root) : [root]));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(readFileSync(path, "utf8")).not.toMatch(/payfast/i);
    }
  });
});
