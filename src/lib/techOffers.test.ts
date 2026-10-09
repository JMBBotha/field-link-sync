import { describe, expect, it } from "vitest";
import { applyTechOffers, durationText, slotText, type TechOffer } from "./leadOffers";

const o = (lead_id: string, km: number | null, fits = true): TechOffer => ({
  lead_id, fits, km, label: "near home", reason: null, slot_date: "2026-10-12", slot_start: "12:05:00", minutes: 210, minutes_source: "quote",
});

describe("tech offers", () => {
  it("formats duration", () => {
    expect(durationText(210)).toBe("≈ 3.5 h");
    expect(durationText(120)).toBe("≈ 2 h");
    expect(durationText(45)).toBe("≈ 45 min");
    expect(durationText(null)).toBe("");
  });
  it("formats the fitting slot", () => {
    const today = new Date(2026, 9, 12, 9, 0);
    expect(slotText("2026-10-12", "12:05:00", today)).toBe("Fits today 12:05");
    expect(slotText("2026-10-13", "08:30:00", today)).toBe("Fits tomorrow 08:30");
    expect(slotText(null, "08:30", today)).toBe("");
  });
  it("keeps only fitting offers, nearest first", () => {
    const leads = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const out = applyTechOffers(leads, { applies: true, offers: [o("b", 4.2), o("c", 1.3), o("d", 0.5, false)] });
    expect(out.map((l) => l.id)).toEqual(["c", "b"]);
    expect(out[0].techOffer?.km).toBe(1.3);
  });
  it("falls back to the unfiltered list when the filter doesn't apply", () => {
    const leads = [{ id: "a" }];
    expect(applyTechOffers(leads, { applies: false, offers: [] })).toBe(leads);
    expect(applyTechOffers(leads, null)).toBe(leads);
  });
});
