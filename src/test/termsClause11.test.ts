import { describe, it, expect } from "vitest";
import { buildTermsBlocks } from "@/lib/defaultTerms";
describe("terms 1.1 (Johan 08:11)", () => {
  it("uses the approved wording with the company's legal name", () => {
    const t = (n: string) => buildTermsBlocks({ companyName: n }).map((b) => b.text).find((x) => x.startsWith("1.1 "));
    expect(t("Massair CT (Pty) Ltd")).toBe("1.1 Thank you for considering Massair CT (Pty) Ltd. By accepting this quotation, you appoint us to supply and install the air conditioning equipment and services described above, in accordance with the terms and conditions below.");
    expect(t("Cool Downline (Pty) Ltd")).toContain("considering Cool Downline (Pty) Ltd.");
  });
});
