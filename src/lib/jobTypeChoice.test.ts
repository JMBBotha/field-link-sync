import fs from "node:fs";
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
    expect(bookingEmail({ kind: "service", day: "Thu 5 Nov" }).html).toContain("R680 excl. VAT");
    expect(bookingEmail({ kind: "installation", day: "Thu 5 Nov" }).html).not.toContain("R680");
    expect(bookingSms({ kind: "service", day: "x" })).not.toMatch(/0800 232 665/);
  });
  it("only an accepted quote counts", () => {
    expect(isAcceptedQuote("accepted")).toBe(true);
    for (const st of ["draft", "sent", "viewed", "option_not_chosen", null]) expect(isAcceptedQuote(st)).toBe(false);
  });
  it("reason is required", () => { expect(validReason("  ")).toBe(false); expect(validReason("Unit beyond repair")).toBe(true); });
});

describe("14:45 release additions", () => {
  const mig = fs.readFileSync("supabase/migrations/20261103143000_job_type_choice.sql", "utf8");
  it("booking email goes through send-transactional-email with the R680 line for service only", () => {
    expect(mig).toContain("send_booking_confirmation");
    expect(mig).toContain("functions/v1/send-transactional-email");
    expect(mig).toMatch(/WHEN p_kind = 'service' THEN '<p[^']*R680 excl\. VAT/);
  });
  it("new lead links back to the service job for photos", () => {
    expect(mig).toContain("source_job_id uuid REFERENCES public.jobs(id)");
  });
  it("WhatsApp template has the call-out line for service bookings", () => {
    const wa = fs.readFileSync("supabase/functions/_shared/appointmentConfirmation.ts", "utf8");
    expect(wa).toContain("Call-out fee: R680 excl. VAT");
    expect(wa).toContain("isCallOutService(opts.serviceType)");
  });
});
