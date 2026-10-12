import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { renderSignatureHtml, renderReminderSignatureHtml, renderSignatureText } from "./emailSignature";

describe("email signature", () => {
  it("app and edge-function copies are identical", () => {
    expect(readFileSync("supabase/functions/_shared/emailSignature.ts", "utf8")).toBe(readFileSync("src/lib/emailSignature.ts", "utf8"));
  });
  it("shows MASSAIR CT and VAT 4630313080, never Massair Ind", () => {
    const all = renderSignatureHtml({ name: "Lisa", title: "Sales", email: "l@x.co" }) + renderReminderSignatureHtml(null) + renderSignatureText(null);
    expect(all).toContain("MASSAIR CT");
    expect(all).toContain("4630313080");
    expect(all.toLowerCase()).not.toContain("ind cc");
  });
  it("person signature has the person; reminder has person and company", () => {
    const r = renderReminderSignatureHtml({ name: "Lisa Smith", email: "lisa@x.co" });
    expect(r).toContain("Lisa Smith");
    expect(r.match(/data-email-signature/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("escapes HTML in names", () => {
    expect(renderSignatureHtml({ name: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});
