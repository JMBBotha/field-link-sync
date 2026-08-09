import { describe, expect, it } from "vitest";
import {
  CONFIDENCE,
  describeCandidate,
  resolveCandidates,
  type EntityCandidate,
} from "../../supabase/functions/_shared/entityResolution";

const c = (
  label: string,
  score: number,
  extra: Partial<EntityCandidate> = {},
): EntityCandidate => ({
  entity_type: "customer",
  id: `${label}-${score}`,
  label,
  sublabel: null,
  reference: null,
  score,
  ...extra,
});

describe("fuzzy entity resolution confidence policy", () => {
  it("auto-selects a single high-confidence match", () => {
    const r = resolveCandidates("andre blom", "customer", [c("Andre Blom", 0.95)]);
    expect(r.decision).toBe("auto");
    expect(r.chosen?.label).toBe("Andre Blom");
  });

  it("asks for clarification when two matches are close together", () => {
    const r = resolveCandidates("blom", "customer", [
      c("Andre Blom", 0.9),
      c("Anna Blom", 0.88),
    ]);
    expect(r.decision).toBe("clarify");
    expect(r.chosen).toBeNull();
    expect(r.prompt).toMatch(/did you mean/i);
  });

  it("asks for clarification on medium confidence", () => {
    const r = resolveCandidates("andrew bloem", "customer", [c("Andre Blom", 0.5)]);
    expect(r.decision).toBe("clarify");
    expect(r.candidates).toHaveLength(1);
  });

  it("asks the user to repeat or spell when confidence is low", () => {
    const r = resolveCandidates("zzz", "customer", [c("Andre Blom", 0.28)]);
    expect(r.decision).toBe("retry");
    expect(r.candidates).toHaveLength(0);
    expect(r.prompt).toMatch(/repeat|spell/i);
  });

  it("returns retry when nothing scores above the floor", () => {
    const r = resolveCandidates("nobody", "customer", [c("Andre Blom", 0.1)]);
    expect(r.decision).toBe("retry");
  });

  it("never auto-selects for risky (write) actions", () => {
    const r = resolveCandidates("andre blom", "customer", [c("Andre Blom", 0.99)], {
      riskyAction: true,
    });
    expect(r.decision).toBe("clarify");
    expect(r.prompt).toMatch(/confirm/i);
  });

  it("caps the candidate list at five, sorted by score", () => {
    const r = resolveCandidates(
      "test",
      "all",
      [0.5, 0.9, 0.7, 0.45, 0.6, 0.55, 0.42].map((s, i) => c(`C${i}`, s)),
    );
    expect(r.candidates).toHaveLength(5);
    expect(r.candidates[0].score).toBe(0.9);
    expect(r.candidates.map((x) => x.score)).toEqual(
      [...r.candidates.map((x) => x.score)].sort((a, b) => b - a),
    );
  });

  it("describes candidates with a disambiguating detail", () => {
    expect(describeCandidate(c("Andre Blom", 0.9, { reference: "0828258036" })))
      .toBe("Andre Blom (0828258036)");
    expect(describeCandidate(c("Andre Blom", 0.9))).toBe("Andre Blom");
  });

  it("uses sane thresholds", () => {
    expect(CONFIDENCE.AUTO).toBeGreaterThan(CONFIDENCE.CLARIFY);
    expect(CONFIDENCE.CLARIFY).toBeGreaterThan(CONFIDENCE.FLOOR);
  });
});
