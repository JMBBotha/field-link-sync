import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextStepSummaryBody } from "@/components/sales/NextStepSheet";
import { daysSince, shortDescription } from "@/lib/nextSteps";

const row = (o: any) => ({ prio: 3, title: "Demo Construction Co", detail: null, amount: null, since: null, owner_id: null, snoozable: true, ...o });
describe("Next step pop-up", () => {
  it("quote: Open quote and Follow up both target that exact quote", () => {
    render(<MemoryRouter><NextStepSummaryBody row={row({ rule: "followup", entity_type: "quote", entity_id: "demo-q42", link: "/admin/quote-builder?quoteId=demo-q42" })}
      s={{ number: "Q-2026-0042", client: "Demo Construction Co", total: 48300, status: "sent", sent: new Date(Date.now() - 4 * 864e5).toISOString(), created: null, desc: "Lounge, Office" }} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId("sheet-open").getAttribute("href")).toBe("/admin/estimates/demo-q42");
    expect(screen.getByTestId("sheet-action").getAttribute("href")).toBe("/admin/quote-builder?quoteId=demo-q42");
    expect(screen.getByText("Q-2026-0042")).toBeTruthy();
    expect(screen.getByText("4 days")).toBeTruthy();
  });
  it("site visit: appointment details with Start quote for that lead", () => {
    render(<MemoryRouter><NextStepSummaryBody row={row({ rule: "no_quote", entity_type: "lead", entity_id: "demo-l7", link: "/admin/quote-builder?leadId=demo-l7" })}
      s={{ number: "Site visit", client: "Demo Client B", total: null, status: "completed", sent: null, created: null, desc: "", when: "31 Oct 2026 · 10:00" }} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId("sheet-action").textContent).toBe("Start quote");
    expect(screen.getByTestId("sheet-action").getAttribute("href")).toBe("/admin/quote-builder?leadId=demo-l7");
    expect(screen.getByText("31 Oct 2026 · 10:00")).toBeTruthy();
  });
  it("helpers", () => {
    expect(shortDescription(["A", "B", "C", "D"], [])).toBe("A, B, C · +1 more");
    expect(shortDescription([], ["Unit 1"])).toBe("Unit 1");
    expect(daysSince(null)).toBeNull();
  });
});
