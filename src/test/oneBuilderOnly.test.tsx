/** Johan 09:49: ONE quote builder for all users. Fails if any route renders a different builder. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import EstimateToBuilderRedirect from "@/components/quoting/EstimateToBuilderRedirect";

const app = readFileSync("src/App.tsx", "utf8");
const FORBIDDEN = ["AdminEstimateDetailPage", "AdminProposalBuilderPage", "FBCreateEstimatePage", "FBQuoteBuilderPage", "AdminQuoteBuilderPage\\b", "ProposalBuilder\\b", "QuoteBuilderTab", "EstimateBuilder\\b"];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("one quote builder", () => {
  it("App.tsx routes no other builder component", () => {
    for (const name of FORBIDDEN) expect(app, name).not.toMatch(new RegExp(`<${name}|import ${name}|\\b${name},`));
    const builderEls = [...app.matchAll(/<Route [^\n]*?<(\w*(?:QuoteBuilder|ProposalBuilder|EstimateBuilder|EstimateDetail|CreateEstimate)\w*)/g)].map((m) => m[1]);
    expect(new Set(builderEls.filter((n) => n !== "EstimateToBuilderRedirect"))).toEqual(new Set(["AdminQuoteBuilderPageUnified"]));
  });
  it("every builder route lands on /admin/quote-builder", () => {
    for (const path of ["/admin/proposal-builder", "/client/:companyId/quote-builder"]) {
      expect(app).toMatch(new RegExp(`path="${path.replace(/[/:]/g, (c) => "\\" + c)}" element=\\{<Navigate to="/admin/quote-builder"`));
    }
    expect(app).toMatch(/path="estimates\/new" element=\{<Navigate to="\/admin\/quote-builder"/);
    expect(app).toMatch(/path="estimates\/:id" element=\{<EstimateToBuilderRedirect \/>\}/);
    expect(app).toMatch(/path="\/field\/quote-builder"[^\n]*<AdminQuoteBuilderPageUnified/);
  });
  it("no live screen embeds the old editors (only the one builder + archived files)", () => {
    const ARCHIVED = /AdminEstimateDetailPage|AdminProposalBuilderPage|FBCreateEstimatePage|FBQuoteBuilderPage|AdminQuoteBuilderPage\.tsx|Proposals\.tsx|ProposalBuilder\.tsx|AreaFirstBuilder|index\.ts$/;
    const offenders = walk("src").filter((f) => !f.includes("/test/") && !ARCHIVED.test(f))
      .filter((f) => /<ProposalBuilder\b|<EstimateBuilder\b|<AdminEstimateDetailPage\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("old /admin/estimates/:id links open the builder with the quote (and keep ?mandy=pdf)", () => {
    const Where = () => { const l = useLocation(); return <p>{l.pathname + l.search}</p>; };
    render(<MemoryRouter initialEntries={["/admin/estimates/q1?mandy=pdf"]}><Routes>
      <Route path="/admin/estimates/:id" element={<EstimateToBuilderRedirect />} />
      <Route path="/admin/quote-builder" element={<Where />} />
    </Routes></MemoryRouter>);
    expect(screen.getByText("/admin/quote-builder?mandy=pdf&quoteId=q1")).toBeTruthy();
  });
  it("sales commission breakdown has no 'no commission on labour' line (calc unchanged)", () => {
    expect(readFileSync("src/components/quoting/StaffMarginCard.tsx", "utf8")).not.toMatch(/no commission on labour/i);
  });
});
