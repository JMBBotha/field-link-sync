import { describe, it, expect } from "vitest";
import { toSpeech } from "../../supabase/functions/_shared/toSpeech";

describe("mandy-agent toSpeech idempotence", () => {
  it("leaves client-formatted rand strings unchanged", () => {
    expect(toSpeech("Quote total R12 763 including VAT.")).toBe("Quote total R12 763 including VAT.");
    expect(toSpeech("That is R9 738 and 26 cents.")).toBe("That is R9 738 and 26 cents.");
  });

  it("never converts spaced-out quote numbers like 'Q 2026 0 0 1 4'", () => {
    const s = toSpeech("Opened Q 2026 0 0 1 4.");
    expect(s).toContain("Q 2026 0 0 1 4");
    expect(s).not.toMatch(/two thousand/i);
  });

  it("still converts raw money for TTS", () => {
    expect(toSpeech("Total R17825.22 excl. VAT")).toMatch(/rand/i);
  });
});
