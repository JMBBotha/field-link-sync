import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { countdown, defaultModeFor, durationLabel, handoffModesFor, handoffStatusText, offerSummary, type InstallOffer } from "@/lib/installHandoff";

const src = (p: string) => readFileSync(p, "utf8");
const offer: InstallOffer = { offer_id: "o", job_id: "j", client: "Sam", suburb: "Bellville", date: "2026-10-14", start: "10:00", minutes: 240, distance_km: 7, respond_by: new Date(Date.now() + 600000).toISOString() };

describe("P3 hand to technician", () => {
  it("salespeople can only offer; office can pick or offer", () => {
    expect(handoffModesFor("rep")).toEqual(["offer"]);
    expect(handoffModesFor("ops")).toEqual(["pick", "offer"]);
  });
  it("preselects from the company default (rep always offer)", () => {
    expect(defaultModeFor("ops", "manual")).toBe("pick");
    expect(defaultModeFor("ops", "auto")).toBe("offer");
    expect(defaultModeFor("rep", "manual")).toBe("offer");
  });
  it("offer card text carries no money", () => {
    const t = offerSummary(offer);
    expect(t).toContain("Bellville");
    expect(t).toContain("4 h");
    expect(t).toContain("7 km away");
    expect(t).not.toMatch(/R\s?\d|ZAR|\btotal\b|price/i);
    expect(Object.keys(offer)).not.toContain("total");
  });
  it("duration labels and countdown", () => {
    expect(durationLabel(90)).toBe("1.5 h");
    expect(durationLabel(480)).toBe("Full day");
    expect(durationLabel(960)).toBe("2 days");
    expect(countdown(new Date(1000 * 125).toISOString(), 0)).toBe("2:05");
  });
  it("status text", () => {
    const base = { role: "rep" as const, default_mode: "manual" as const, job_id: "j", technician: null, pending: 0, round: 1, unclaimed: false };
    expect(handoffStatusText({ ...base, technician: "Thabo" })).toBe("Handed to Thabo");
    expect(handoffStatusText({ ...base, pending: 2 })).toMatch(/Offered to 2 technicians/);
    expect(handoffStatusText({ ...base, unclaimed: true })).toMatch(/office has been asked/);
    expect(handoffStatusText({ ...base, role: "ops", unclaimed: true })).toBe("No technician took it — pick one");
  });
  it("hand-off goes through the server RPC only (no direct job/assignment/schedule writes)", () => {
    const s = src("src/components/quoting/AcceptedWorkSection.tsx");
    expect(s).toContain('rpc("hand_to_technician"');
    expect(s).not.toMatch(/from\("assignments"\)/);
    expect(s).not.toMatch(/from\("job_schedules"\)/);
    expect(s).not.toMatch(/from\("jobs"\)\s*\.insert/);
    expect(s).not.toContain("Leave open (first-accept)");
  });
  it("install offers have their own tech inbox and stay out of the lead offer cards", () => {
    expect(src("src/components/dispatch/OfferCards.tsx")).toContain('.neq("offer_type", "install")');
    expect(src("src/pages/FieldAgent.tsx")).toContain("<InstallOfferCards />");
    const c = src("src/components/field/InstallOfferCards.tsx");
    expect(c).toContain('"claim_install_offer"');
    expect(c).not.toMatch(/fmtRand|formatCurrency|total/);
  });
});
