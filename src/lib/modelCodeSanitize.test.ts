import { describe, it, expect } from "vitest";
import { sanitizeModelCode, looksGarbled, money2 } from "./modelCodeSanitize";

describe("sanitizeModelCode", () => {
  it("fixes '<' to K and flags it", () => {
    const r = sanitizeModelCode("MR<-A10N");
    expect(r.code).toBe("MRK-A10N");
    expect(r.lowConfidence).toBe(true);
    expect(r.flags[0]).toBe("model_code_ocr_fixed:MR<-A10N");
  });
  it("maps accented Greek Y to Latin Y", () => {
    expect(sanitizeModelCode("MIM-H04ΎN").code).toBe("MIM-H04YN");
  });
  it("uppercases and strips spaces without flagging", () => {
    const r = sanitizeModelCode(" ar12 txfyawkn ");
    expect(r.code).toBe("AR12TXFYAWKN");
    expect(r.lowConfidence).toBe(false);
  });
  it("flags unreadable characters instead of guessing", () => {
    const r = sanitizeModelCode("MIM-H04?N");
    expect(r.code).toBe("MIM-H04?N");
    expect(r.flags).toContain("model_code_unreadable");
  });
});

describe("looksGarbled", () => {
  it("detects Greek in text", () => expect(looksGarbled("MIM-H04ΎN Wired remote control unit")).toBe(true));
  it("accepts clean text", () => expect(looksGarbled("AR12TXFYAWKN Wind-Free Elite indoor unit 12000 BTU R 9 999,00")).toBe(false));
  it("detects mid-word case flips", () => expect(looksGarbled("hI Style wERsonalized cOmfort mOde aIr unit clean")).toBe(true));
});

describe("money2", () => {
  it("rounds 2999.87 less 20% to 2 decimals", () => expect(money2(2999.87 * 0.8)).toBe(2399.9));
});
