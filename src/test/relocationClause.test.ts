import { describe, it, expect } from "vitest";
import { isRelocationLine, quoteHasRelocation, showRelocationClause, RELOCATION_CLAUSE_DEFAULT } from "@/lib/relocationClause";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { groupTermsSections } from "@/components/quoting/QuoteTermsPage";

describe("relocation detector", () => {
  it.each([
    "Removal of existing air conditioner",
    "Removal and reinstallation of existing air conditioner",
    "Relocate existing 12000BTU split unit to bedroom 2",
    "Remove existing outdoor unit and reinstall on new bracket",
    "Decommission and recommission existing cassette",
    "Uninstall old aircon",
    "Removal of existing A/C",
  ])("detects %s", (t) => expect(isRelocationLine(t)).toBe(true));

  it.each([
    "Supply and install: relocate existing ducts, spigots, supply diffusers & extract points", // Q-0041
    "Strip & reuse old ducting",
    "Standard back-to-back installation", // STD-B2B
    "Supply and install new 18000BTU inverter split unit",
    "Remove old grilles and replace",
    "",
  ])("ignores %s", (t) => expect(isRelocationLine(t)).toBe(false));

  it("auto / on / off", () => {
    const reloc = ["Labour", "Removal of existing air conditioner"];
    const plain = ["Supply and install new split unit", "relocate existing ducts, spigots, supply diffusers & extract points"];
    expect(quoteHasRelocation(reloc)).toBe(true);
    expect(showRelocationClause(null, reloc)).toBe(true);
    expect(showRelocationClause(null, plain)).toBe(false);
    expect(showRelocationClause("on", plain)).toBe(true);
    expect(showRelocationClause("off", reloc)).toBe(false);
  });
});

describe("terms numbering", () => {
  const heads = (o: object) => groupTermsSections(buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", bankName: "FNB", accountNumber: "123", ...o } as any)).map((s) => s.heading);
  const para = (o: object) => buildTermsBlocks({ companyName: "Massair CT (Pty) Ltd", bankName: "FNB", accountNumber: "123", ...o } as any).filter((b) => b.type === "paragraph").map((b) => b.text);
  const idx = (h: string[]) => h.findIndex((x) => /Existing \/ relocated units/.test(x));

  it("no clause unless relocated", () => expect(idx(heads({}))).toBe(-1));
  it("section 12 normally", () => {
    expect(idx(heads({ relocatedUnits: true }))).toBe(11);
    expect(para({ relocatedUnits: true })).toContain(`12.1 ${RELOCATION_CLAUSE_DEFAULT}`);
  });
  it("section 13 after the phone/online section", () => {
    expect(idx(heads({ relocatedUnits: true, remoteQuote: true }))).toBe(12);
    expect(para({ relocatedUnits: true, remoteQuote: true }).some((t) => t.startsWith("13.1 This quote includes removing"))).toBe(true);
  });
  it("uses company wording", () => expect(para({ relocatedUnits: true, relocationText: "Custom wording." })).toContain("12.1 Custom wording."));
});
