import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/contexts/QuoteContext", () => ({ useQuoteContext: () => ({}), trackQuoteWrite: (p: unknown) => p }));
import LabourModeSwitch, { LABOUR_SWITCH_LABEL, LABOUR_SWITCH_OFF_TEXT, LABOUR_SWITCH_ON_TEXT } from "@/components/quoting/LabourModeSwitch";

const app = readFileSync("src/App.tsx", "utf8");
const routeFor = (path: string) => {
  const line = app.split("\n").find((l) => l.includes(`path="${path}"`));
  if (!line) throw new Error(`no route ${path}`);
  return line;
};
const roles = (line: string) => (line.match(/allowedRoles=\{\[([^\]]*)\]\}/)?.[1] ?? "").replace(/["\s]/g, "").split(",");

describe("one quote builder for every role", () => {
  it("sales (dispatcher) and admin resolve to the same builder component on admin and field routes", () => {
    for (const p of ["/admin/quote-builder", "/field/quote-builder"]) {
      const l = routeFor(p);
      expect(l).toContain("<AdminQuoteBuilderPageUnified");
      expect(roles(l)).toEqual(expect.arrayContaining(["admin", "dispatcher"]));
      expect(l).not.toContain("denySalesRep");
    }
    // the estimate page (opening an existing quote) is one route with no role split
    expect(routeFor("estimates/:id")).toContain("<AdminEstimateDetailPage />");
  });
  it("no legacy builder is routed or rendered for any role", () => {
    expect(app).not.toMatch(/<FBQuoteBuilderPage|<AdminQuoteBuilderPage[ />]/);
    expect(routeFor("/client/:companyId/quote-builder")).toContain('<Navigate to="/admin/quote-builder" replace />');
    const catalog = readFileSync("src/pages/admin/AdminCatalogPage.tsx", "utf8");
    expect(catalog).not.toContain("<QuoteBuilderTab");
    expect(catalog).toContain('navigate("/admin/quote-builder")');
    const quotes = readFileSync("src/pages/admin/AdminQuotesPage.tsx", "utf8");
    expect(quotes).toContain('onCreateNew={() => navigate("/admin/quote-builder")}');
  });
  it("builders contain no role-based switch to a different component", () => {
    for (const f of ["src/pages/admin/AdminQuoteBuilderPageUnified.tsx", "src/pages/admin/AdminEstimateDetailPage.tsx", "src/pages/admin/AdminQuotesPage.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/isSalesRep\s*\?\s*</);
    }
  });
});

describe("labour toggle visibility", () => {
  it("shows labels on both sides, orange when on, darker track when off, white thumb", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LabourModeSwitch checked={false} onChange={onChange} />);
    expect(screen.getByText(LABOUR_SWITCH_OFF_TEXT)).toBeTruthy();
    expect(screen.getByText(LABOUR_SWITCH_ON_TEXT)).toBeTruthy();
    const sw = screen.getByRole("switch", { name: LABOUR_SWITCH_LABEL });
    expect(sw.className).toContain("data-[state=checked]:bg-orange-600");
    expect(sw.className).toContain("data-[state=unchecked]:bg-orange-200");
    expect(sw.className).toContain("data-[state=unchecked]:border-orange-400");
    expect(sw.className).toContain("[&>span]:bg-white");
    expect(sw.hasAttribute("data-no-min")).toBe(true);
    fireEvent.click(screen.getByText(LABOUR_SWITCH_ON_TEXT));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<LabourModeSwitch checked onChange={onChange} />);
    expect(screen.getByText(LABOUR_SWITCH_ON_TEXT).className).toContain("text-[#c2410c]");
    // solid white pill that the dark-mode remaps skip
    expect(screen.getByTestId("labour-mode-switch").hasAttribute("data-paper")).toBe(true);
    expect(screen.getByTestId("labour-mode-switch").className).toContain("bg-[#ffffff]");
    fireEvent.click(screen.getByText(LABOUR_SWITCH_OFF_TEXT));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
