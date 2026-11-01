import { describe, it, expect } from "vitest";
import { cardTarget, buttonTarget } from "@/lib/nextSteps";

const q = (rule: any, id: string) => ({ rule, entity_type: "quote", entity_id: id, link: `/admin/quote-builder?quoteId=${id}` });
describe("Next steps open the exact record", () => {
  it("quote follow-ups open that quote, Follow up targets the same quote", () => {
    expect(cardTarget(q("followup", "q41"))).toBe("/admin/estimates/q41");
    expect(cardTarget(q("followup", "q42"))).toBe("/admin/estimates/q42");
    expect(buttonTarget(q("followup", "q42"))).toBe("/admin/quote-builder?quoteId=q42");
    expect(cardTarget(q("cold", "q9"))).toBe("/admin/estimates/q9");
  });
  it("site visit done, no quote: card opens the lead/appointment, Start quote keeps the builder", () => {
    const r = { rule: "no_quote" as const, entity_type: "lead", entity_id: "L1", link: "/admin/quote-builder?leadId=L1" };
    expect(cardTarget(r)).toBe("/admin/dispatch?lead=L1");
    expect(buttonTarget(r)).toBe("/admin/quote-builder?leadId=L1");
  });
  it("new lead opens the lead, not the bare board", () => {
    const r = { rule: "new_lead" as const, entity_type: "lead", entity_id: "L2", link: "/admin/dispatch" };
    expect(cardTarget(r)).toBe("/admin/dispatch?lead=L2");
    expect(buttonTarget(r)).toBe("/admin/dispatch?lead=L2");
  });
  it("invoices and jobs keep their record link", () => {
    expect(cardTarget({ rule: "book_install", entity_type: "invoice", entity_id: "I1", link: "/admin/invoices/I1" })).toBe("/admin/invoices/I1");
  });
});
