import { describe, it, expect } from "vitest";
import { quoteSettingsSummary } from "@/components/quoting/QuoteSettingsPanel";
describe("quote settings summary (Johan 00:08)", () => {
  it("one line", () => {
    expect(quoteSettingsSummary({ status: "draft", plan: "70/30", unitCards: true, note: "x" })).toBe("Draft · 70/30 · Unit cards on · note added");
    expect(quoteSettingsSummary({ status: "sent", plan: null, unitCards: false, note: " " })).toBe("Sent · Default plan · Unit cards off · no note");
  });
});
