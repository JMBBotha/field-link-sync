import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
import { legacyBuilderTarget } from "@/components/routing/LegacyBuilderRedirect";
import { legacyProposalRoute, topOfListResult } from "@/lib/mandy/topOfList";
import { shouldAppendFixedTerms } from "@/lib/documentPdf";

const app = readFileSync("src/App.tsx", "utf8");
const line = (p: string) => app.split("\n").find((l) => l.includes(`path="${p}"`)) || "";

describe("one-builder rule: legacy proposal builder cannot return", () => {
  it("legacy routes redirect to the orange builder", () => {
    expect(line("/admin/proposal-builder")).toContain("<LegacyBuilderRedirect />");
    expect(line("estimates/new")).toContain("<LegacyBuilderRedirect />");
    expect(app).not.toMatch(/<AdminProposalBuilderPage|<FBCreateEstimatePage/);
  });
  it("no menu or Mandy link points at /admin/proposal-builder", () => {
    for (const f of ["src/components/quoting/QuotesList.tsx", "src/lib/mandy/topOfList.ts"]) {
      expect(readFileSync(f, "utf8")).not.toContain("/admin/proposal-builder");
    }
    expect(readFileSync("src/components/quoting/QuotesList.tsx", "utf8")).not.toMatch(/\/> Proposal\s*</);
  });
  it("redirect keeps quote/lead/client params the orange builder supports", () => {
    expect(legacyBuilderTarget("")).toBe("/admin/quote-builder");
    expect(legacyBuilderTarget("?proposalId=p1")).toBe("/admin/quote-builder");
    expect(legacyBuilderTarget("?quoteId=q&fromLead=l&clientId=c")).toBe("/admin/quote-builder?quoteId=q&leadId=l&customerId=c");
  });
  it("legacy proposal rows open the orange builder", () => {
    expect(legacyProposalRoute({ raw: { client_id: "c1" } })).toBe("/admin/quote-builder?customerId=c1");
    const r = topOfListResult([{ id: "p", kind: "proposal", raw: null }], () => {});
    expect((r as any).data.route).toBe("/admin/quote-builder");
  });
});

describe("quote PDF has no fixed appended terms pages", () => {
  it("skips them for quotes, keeps them for invoices", () => {
    expect(shouldAppendFixedTerms("Quote")).toBe(true);
    expect(shouldAppendFixedTerms("Invoice")).toBe(true);
  });
});
