import { describe, it, expect } from "vitest";
import { isAcceptedQuote, leadServiceTypeFor, jobTypeFor, kindOfJobType, techJobTypeLabel, bookingSms, bookingEmail, validReason } from "./jobTypeChoice";
import { laneFromServiceType } from "./leadLane";

describe("job type choice", () => {
  it("maps to the existing lanes", () => {
    expect(laneFromServiceType(leadServiceTypeFor("service"))).toBe("service");
    expect(laneFromServiceType(leadServiceTypeFor("installation"))).toBe("sales");
  });
  it("installation is a quote until the quote is accepted", () => {
    expect(jobTypeFor("installation")).toBe("quote");
    expect(jobTypeFor("installation", true)).toBe("installation");
    expect(jobTypeFor("service", true)).toBe("service");
  });
  it("labels", () => {
    expect(kindOfJobType("repair")).toBe("service");
    expect(kindOfJobType("quote")).toBe("installation");
    expect(kindOfJobType("move")).toBeNull();
    expect(techJobTypeLabel("quote")).toContain("Quote");
    expect(techJobTypeLabel("installation")).toBe("❄️ Installation");
  });
  it("call-out line only on service bookings", () => {
    expect(bookingSms({ kind: "service", day: "Thu 5 Nov", time: "10:00" })).toContain("R680 excl. VAT");
    expect(bookingSms({ kind: "installation", day: "Thu 5 Nov" })).not.toContain("R680");
    expect(bookingEmail({ kind: "service", day: "Thu 5 Nov" }).html).toContain("never deducted");
    expect(bookingEmail({ kind: "installation", day: "Thu 5 Nov" }).html).not.toContain("R680");
    expect(bookingSms({ kind: "service", day: "x" })).not.toMatch(/0800 232 665/);
  });
  it("only an accepted quote counts", () => {
    expect(isAcceptedQuote("accepted")).toBe(true);
    for (const st of ["draft", "sent", "viewed", "option_not_chosen", null]) expect(isAcceptedQuote(st)).toBe(false);
  });
  it("reason is required", () => { expect(validReason("  ")).toBe(false); expect(validReason("Unit beyond repair")).toBe(true); });
});
