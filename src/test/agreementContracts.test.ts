import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { contractFields, frequencyLabel, sameClientCheck } from "@/lib/agreementTemplates/contracts";
import { buildAgreementPdf } from "@/lib/agreementTemplates/pdf";
import { fillFields } from "@/lib/agreementTemplates/markup";

describe("service contract instances", () => {
  it("multi-select only allows invoices for one client", () => {
    expect(sameClientCheck([])).toMatchObject({ ok: false });
    expect(sameClientCheck([{ id: "1", customer_id: "a" }, { id: "2", customer_id: "a" }])).toEqual({ ok: true, customerId: "a" });
    expect(sameClientCheck([{ id: "1", customer_id: "a" }, { id: "2", customer_id: "b" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/same client/) });
    expect(sameClientCheck([{ id: "1", customer_id: null, label: "INV-9" }])).toMatchObject({ ok: false, reason: expect.stringMatching(/INV-9.*not linked/) });
  });

  it("fills client / contract fields", () => {
    const f = contractFields({ contract_number: "SC-2026-001", start_date: "2026-11-01", frequency: "biannual", client_snapshot: { name: "Test Co", vat: "4123" } });
    expect(fillFields("{{contract.number}} {{client.name}} VAT {{client.vat}} {{contract.frequency}}", f)).toBe("SC-2026-001 Test Co VAT 4123 Twice a year");
    expect(frequencyLabel("annual")).toBe("Once a year");
  });

  it("PDF builds with a filled units register and client VAT", () => {
    const doc = buildAgreementPdf({
      contractNo: "SC-2026-001", company: { name: "AB Refrigeration" }, client: { name: "Test Co", vat: "4123456789" },
      units: Array.from({ length: 25 }, (_, i) => ({ location: `Room ${i}`, model: "Samsung AR09", size: "9000", ref: "INV-1" })),
      sections: [{ doc_kind: "contract", position: 1, kind: "units", heading: "Schedule A – Covered units", body: "" }],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("server rules: invoker create, same-client guard, no agreement/job side effects", () => {
    const sql = readFileSync("supabase/migrations/20261018210000_agreement_contracts.sql", "utf8");
    expect(sql).toMatch(/create_agreement_contract[\s\S]*security invoker/);
    expect(sql).toContain("All selected invoices must belong to the same client");
    expect(sql).toContain("All selected jobs must belong to the same client");
    expect(sql).toMatch(/not public\.is_field_tech_only\(_uid\)/);
    // creating a contract never writes service_agreements / jobs / reminders
    expect(sql).not.toMatch(/insert\s+into\s+public\.(service_agreements|jobs|maintenance_reminders)/i);
    expect(sql).not.toMatch(/update\s+public\.(service_agreements|jobs)\b/i);
  });
});
