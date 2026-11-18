import { describe, it, expect } from "vitest";
import { v8BalanceOnJobDone, v8BalanceReminders, v8PayBalance } from "@/lib/v8simple/balance";
import { v8Stage } from "@/lib/v8simple/stage";

describe("balance", () => {
  it("is the quote total minus the deposit, due the day the job is done, and ignores the call-out", () => {
    const invoice = v8BalanceOnJobDone({ quoteNo: "Q-1088", quoteTotal: 20000, deposit: 14000, callOutExclVat: 680, doneOn: "2026-11-17" });
    expect(invoice.total).toBe(6000);
    expect(invoice.total).not.toBe(6000 - 680);
    expect(invoice.dueOn).toBe("2026-11-17");
    expect(invoice.callOutExclVat).toBe(680);
    expect(v8BalanceReminders("2026-11-17")).toEqual(["2026-11-18", "2026-11-20", "2026-11-24"]);
    const paid = v8PayBalance(invoice, "yoco");
    expect(paid.closed).toBe(true);
    expect(paid.status).toBe("paid");
    expect(v8Stage({ quoteStatus: "accepted", depositPaid: true, completedAt: "2026-11-17", balanceRemaining: 0, paid: true }).label).toBe("Paid");
  });
});
