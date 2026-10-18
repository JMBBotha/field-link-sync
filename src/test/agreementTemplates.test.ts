import { describe, expect, it } from "vitest";
import {
  addSection, docSections, fillFields, listFields, moveSection, parseBody, parseInline, removeSection, toSavePayload,
  type TemplateSection,
} from "@/lib/agreementTemplates/markup";
import { buildAgreementPdf, companyFields, pdfSafe } from "@/lib/agreementTemplates/pdf";
import { agreementCompanyFromProfile, shortCompanyName, templateFilePath } from "@/lib/agreementTemplates/api";

const S = (doc: "contract" | "sla", position: number, heading: string, body = ""): TemplateSection =>
  ({ doc_kind: doc, position, kind: "text", heading, body });

describe("agreement template markup", () => {
  it("parses clauses, bullets, tables and paragraphs", () => {
    const b = parseBody("2.1 We will **visit**.\n- 2.2 Bullet clause\n- plain bullet\n| Term | Meaning |\n|---|---|\n| A | B |\nIntro line");
    expect(b.map((x) => x.type)).toEqual(["clause", "bullet", "bullet", "table", "paragraph"]);
    expect(b[0]).toMatchObject({ num: "2.1", text: "We will **visit**." });
    expect(b[1]).toMatchObject({ num: "2.2" });
    expect(b[3]).toMatchObject({ header: ["Term", "Meaning"], rows: [["A", "B"]] });
  });

  it("keeps bold on a bolded clause heading", () => {
    const [c] = parseBody("**3.1 Our recommendation** text");
    expect(c).toMatchObject({ type: "clause", num: "3.1", text: "**Our recommendation** text" });
    expect(parseInline("**Our recommendation** text")[0]).toEqual({ text: "Our recommendation", bold: true });
  });

  it("fills company fields and leaves a visible blank for missing ones", () => {
    const f = companyFields({ name: "AB Refrigeration", vat: "" });
    expect(fillFields("{{company.name}} (VAT {{company.vat}})", f)).toBe("AB Refrigeration (VAT [company.vat])");
    expect(listFields([{ heading: "x", body: "{{company.name}} {{ company.phone }}" }])).toEqual(["company.name", "company.phone"]);
  });

  it("adds, moves and removes sections within one document and renumbers", () => {
    let all = [S("contract", 1, "A"), S("contract", 2, "B"), S("sla", 1, "S1")];
    all = moveSection(all, "contract", 1, -1);
    expect(docSections(all, "contract").map((s) => s.heading)).toEqual(["B", "A"]);
    all = addSection(all, "contract", 0);
    expect(docSections(all, "contract").map((s) => [s.heading, s.position])).toEqual([["B", 1], ["New section", 2], ["A", 3]]);
    all = removeSection(all, "contract", 1);
    expect(docSections(all, "contract").map((s) => s.heading)).toEqual(["B", "A"]);
    expect(docSections(all, "sla").map((s) => s.heading)).toEqual(["S1"]);
    expect(toSavePayload(all).map((s) => `${s.doc_kind}:${s.position}`)).toEqual(["contract:1", "contract:2", "sla:1"]);
  });
});

describe("agreement PDF", () => {
  it("builds a multi-section PDF with the SLA as Schedule B", () => {
    const sections: TemplateSection[] = [
      S("contract", 1, "Parties", "1.1 Between **{{company.name}}** and you."),
      { doc_kind: "contract", position: 2, kind: "signatures", heading: "Signatures", body: "By signing…" },
      { doc_kind: "contract", position: 3, kind: "units", heading: "Schedule A – Covered units", body: "Units below." },
      S("sla", 1, "Status", "1.1 This SLA ≥ the contract."),
    ];
    const doc = buildAgreementPdf({ draft: true, sections, company: { name: "Massair CT (Pty) Ltd", vat: "4630313080" } });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("replaces characters the standard PDF font cannot draw", () => {
    expect(pdfSafe("≥ 5 ✓ – “ok”")).toBe(">= 5 v – “ok”");
  });
});

describe("issuing company on output", () => {
  it("downline companies print their own details, never Massair's", () => {
    const c = agreementCompanyFromProfile({
      id: "p", company_id: "d9b494c7-cdb2-4e86-b4e9-8860c3519dbd", legal_name: "AB Refrigeration (Pty) Ltd", trading_name: null,
      vat_number: null, phone: "011 000 0000", email: "ab@example.com", website: null, whatsapp: null, address_lines: ["1 Main Rd"],
      bank_name: null, account_name: null, account_number: null, branch_code: null, account_type: null, terms_text: null,
      invoice_prefix: "INV", use_shared_sequence: false, is_default: true, archived_at: null,
    });
    expect(c.name).toBe("AB Refrigeration (Pty) Ltd");
    expect(c.short).toBe("AB Refrigeration");
    expect(c.vat).toBeFalsy();
    expect(c.signatory).toBe("");
    expect(JSON.stringify(c)).not.toMatch(/Massair|4630313080|0800becool/);
  });

  it("Massair keeps its short name", () => {
    expect(shortCompanyName({ company_id: "361bf031-9cdb-4d7f-9bde-9eb95fa4725e", legal_name: "Massair CT (Pty) Ltd" })).toBe("Massair");
  });

  it("stores files under <company>/templates/<template>/ (matches the storage policy)", () => {
    const p = templateFilePath("361bf031-9cdb-4d7f-9bde-9eb95fa4725e", "5b1c0e7a-6d2f-4c1e-9a8b-0c4f2a7e1d01", "contract_pdf_path", "Service Contract (DRAFT).pdf");
    const parts = p.split("/");
    expect(parts[0]).toBe("361bf031-9cdb-4d7f-9bde-9eb95fa4725e");
    expect(parts[1]).toBe("templates");
    expect(parts[2]).toBe("5b1c0e7a-6d2f-4c1e-9a8b-0c4f2a7e1d01");
    expect(parts[3]).toMatch(/^contract_pdf-\d+-Service_Contract_DRAFT_.pdf$/);
  });
});
