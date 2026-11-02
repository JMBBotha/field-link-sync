import { describe, it, expect } from "vitest";
import { wavesDue, repsOffered, roughArea, rankReps, DEFAULT_LEAD_OFFERS as S, clampInt, OFFER_LIMITS } from "./requestOffers";

describe("lead offer waves (5/2/10)", () => {
  it("wave timing", () => {
    expect([0, 4.9, 5, 6.9, 7, 9, 10].map((m) => wavesDue(m, S))).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });
  it("reps offered: 3, +2 at 5, +2 at 7, +2 at 9, capped by team", () => {
    expect([0, 5, 7, 9].map((m) => repsOffered(m, S, 20))).toEqual([3, 5, 7, 9]);
    expect(repsOffered(9, S, 8)).toBe(8);
  });
  it("ships off by default", () => expect(S.enabled).toBe(false));
  it("first wave clamps to 3-5", () => { expect(clampInt(9, OFFER_LIMITS.first_wave)).toBe(5); expect(clampInt(1, OFFER_LIMITS.first_wave)).toBe(3); });
});
describe("roughArea", () => {
  it("drops house and street part", () => {
    expect(roughArea("Demo Estate / Somerset West — House 12")).toBe("Somerset West");
    expect(roughArea("12 Demo Road")).toBe("Demo Road");
    expect(roughArea("")).toBeNull();
  });
});
describe("rankReps", () => {
  it("availability > distance > skill > workload", () => {
    const r = rankReps([
      { id: "off", available: false, km: 1, skill: true, load: 0 },
      { id: "far", available: true, km: 9, skill: true, load: 0 },
      { id: "near-noskill", available: true, km: 3, skill: false, load: 0 },
      { id: "near-skill-busy", available: true, km: 3, skill: true, load: 4 },
      { id: "near-skill-free", available: true, km: 3, skill: true, load: 1 },
    ]).map((x) => x.id);
    expect(r).toEqual(["near-skill-free", "near-skill-busy", "near-noskill", "far", "off"]);
  });
});
