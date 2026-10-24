import { describe, expect, it } from "vitest";
import { addDaysIso, STATUS_LABEL } from "@/components/invoicing/PaymentSchedulePanel";
describe("payment schedule helpers", () => {
  it("adds days across month/year ends", () => {
    expect(addDaysIso("2026-10-12", 30)).toBe("2026-11-11");
    expect(addDaysIso("2026-12-15", 30)).toBe("2027-01-14");
  });
  it("labels drafts as not sent, never overdue", () => { expect(STATUS_LABEL.not_sent).toBe("Not sent yet"); });
});
