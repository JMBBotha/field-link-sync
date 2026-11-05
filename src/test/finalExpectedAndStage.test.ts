import { describe, it, expect } from "vitest";
import { expectedFinal, installStage } from "@/lib/balanceDue";
import { dueChip, shortDueLabel } from "@/lib/invoiceDue";

const b = { waiting: true, balance: 38213.39, status: "partially_paid", deposit_amount: 38213.4, deposit_paid: 38213.4, job_done: null };
describe("expected final payment (House 88 / 0010006)", () => {
  it("shows the pencil date only when it was set manually", () => {
    expect(expectedFinal(b, { due_date: "2026-12-01", due_date_source: "manual" })).toBe("2026-12-01");
    expect(expectedFinal(b, { due_date: "2026-10-12", due_date_source: null })).toBeNull(); // auto issue-date due on siblings
    expect(expectedFinal({ ...b, balance: 0 }, { due_date: "2026-12-01", due_date_source: "manual" })).toBeNull();
    expect(expectedFinal({ ...b, waiting: false }, { due_date: "2026-12-01", due_date_source: "manual" })).toBeNull();
  });
  it("due chip reads Expected 1 Dec", () => {
    const c = dueChip({ days: 0, waiting: true, on_completion: true, install_at: "2026-11-03T09:00:00Z", expected_at: "2026-12-01" });
    expect(c.label).toBe("Expected 1 Dec");
    expect(shortDueLabel(c.label)).toBe("Expected 1 Dec");
  });
});
describe("install stage colours (PR #168 tile colours)", () => {
  const steps = (...k: string[]) => ["first_fit", "piping", "units", "commissioning"].map((s) => ({ step_key: s, done: k.includes(s) }));
  it("purple only when the job is complete and the balance is unpaid", () => {
    expect(installStage(b, steps("first_fit", "piping", "units", "commissioning"))?.label).toBe("Job complete · final 50% unpaid");
    expect(installStage({ ...b, job_done: "2026-11-04" }, [])?.key).toBe("installed");
    expect(installStage(b, steps("first_fit", "piping", "units"))?.key).toBe("first_fit");
  });
  it("green paid, red deposit due, orange first fit, none otherwise", () => {
    expect(installStage({ ...b, balance: 0 }, [])?.key).toBe("paid");
    expect(installStage({ ...b, deposit_paid: 0 }, steps("first_fit"))?.label).toBe("Deposit 50% unpaid · invoice sent");
    expect(installStage({ ...b, deposit_paid: 0 }, steps("first_fit", "piping", "units"))?.key).toBe("due");
    expect(installStage(b, steps("first_fit"))?.key).toBe("first_fit");
    expect(installStage(b, [])).toBeNull();
  });
});
