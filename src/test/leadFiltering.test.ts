import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { mergeOffers, offerText, FLAG_LABEL } from "@/lib/leadOffers";

describe("Lead filtering: rep offer list", () => {
  const rows = [
    { lead_id: "m1", is_mine: true },
    { lead_id: "a-far", is_mine: false },
    { lead_id: "a-near", is_mine: false },
    { lead_id: "m2", is_mine: true },
  ];
  it("keeps own rows first and sorts available nearest first with labels", () => {
    const out = mergeOffers(rows, [
      { lead_id: "a-far", km: 12.4, label: "near your 14:00 job" },
      { lead_id: "a-near", km: 3.3, label: "near home" },
    ]);
    expect(out.map((r) => r.lead_id)).toEqual(["m1", "m2", "a-near", "a-far"]);
    expect(out[2].offer_label).toBe("near home");
  });
  it("formats km and label", () => {
    expect(offerText(3.3, "near home")).toBe("3.3 km · near home");
    expect(offerText(null, null)).toBe("");
  });
  it("admin flag labels include Needs appointment time", () => {
    expect(FLAG_LABEL.needs_time).toBe("Needs appointment time");
  });
});

describe("Lead filtering: office lead entry needs date and time", () => {
  const src = readFileSync("src/components/CreateLeadDialog.tsx", "utf8");
  it("blocks save without appointment and says so", () => {
    expect(src).toMatch(/const hasAppointment = !!scheduledDate && /);
    expect(src).toMatch(/longitude !== null &&\s*hasAppointment;/);
    expect(src).toContain("Add the appointment date and time");
    expect(src).not.toContain("Scheduled Date & Time (Optional)");
  });
  it("admin home shows the flags card for office users only", () => {
    const home = readFileSync("src/components/AdminHome.tsx", "utf8");
    expect(home).toContain("{!isSalesRep && <LeadOfferFlagsCard />}");
  });
});
