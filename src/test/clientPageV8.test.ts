import { describe, it, expect } from "vitest";
import { dueChip, summarizeDue, termsLabel } from "@/lib/invoiceDue";
import { buildActivity } from "@/components/customers/ClientV8Parts";

describe("client page V8 + payment terms", () => {
  it("waiting invoices show completion chip and are not counted as overdue", () => {
    expect(dueChip({ days: 0, waiting: true, terms_days: 30 }).label).toBe("Due 30 days after completion");
    const s = summarizeDue([{ invoice_id: "a", amount_due: 100, days: 0, waiting: true } as any, { invoice_id: "b", amount_due: 50, days: 9 } as any]);
    expect(s.overdue.amount).toBe(50); expect(s.total).toBe(50);
  });
  it("terms labels", () => {
    expect(termsLabel("completion", 30)).toBe("30 days after job completion");
    expect(termsLabel(null, null)).toMatch(/Company default/);
  });
  it("activity merges sources newest first", () => {
    const a = buildActivity({ notes: [{ id: "1", body: "gate code", created_at: "2026-10-01T10:00:00Z" }], calls: [{ id: "2", direction: "inbound", duration_seconds: 240, created_at: "2026-10-02T10:00:00Z" }] });
    expect(a.map((x) => x.kind)).toEqual(["call", "note"]); expect(a[0].text).toContain("4 min");
  });
});
