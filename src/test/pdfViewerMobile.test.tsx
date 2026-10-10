import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "fs";
import QuotePdfViewer from "@/components/quoting/QuotePdfViewer";

describe("Quote PDF viewer on phones (Johan 20:18)", () => {
  it("has Back/Save/WhatsApp/Email/Download + Home; share never sends directly", () => {
    const onBack = vi.fn(), onSave = vi.fn(), onShare = vi.fn();
    render(<MemoryRouter><QuotePdfViewer url="blob:x" fileName="Quote-Q1.pdf" title="Quote Q1" onBack={onBack} onSave={onSave} onShare={onShare} /></MemoryRouter>);
    const bar = screen.getByTestId("pdf-viewer-actions");
    expect(bar.textContent).toMatch(/Back to quote.*Save.*WhatsApp.*Email.*Download/);
    expect(screen.getByTestId("pdf-viewer-home")).toBeTruthy();
    fireEvent.click(screen.getByText("Email")); fireEvent.click(screen.getByText("WhatsApp"));
    expect(onShare).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("Save")); expect(onSave).toHaveBeenCalled();
  });
  it("hook: phones open the in-app viewer; share closes it then opens the Send dialog", () => {
    const h = readFileSync("src/hooks/useQuoteDocumentActions.tsx", "utf8");
    expect(h).toMatch(/if \(isPhoneViewport\(\)\)/);
    expect(h).toContain("closePdfView(); void handleSend();");
  });
});

describe("Visual PDF toolbar on phones (Johan 20:20)", () => {
  it("clutter is desktop-only, also in phone landscape; builder tabs hidden over Visual PDF on phones", () => {
    const v = readFileSync("src/components/catalog/quote-builder/VisualCatalogPanel.tsx", "utf8");
    expect(v.match(/vpdf-desk/g)?.length).toBe(9);
    expect(v).toContain('data-testid="vpdf-zoom-tools"');
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/@media \(pointer: coarse\) and \(max-height: 500px\)[\s\S]*\.vpdf-desk \{ display: none !important; \}/);
    const u = readFileSync("src/pages/admin/AdminQuoteBuilderPageUnified.tsx", "utf8");
    expect(u).toContain('activeTab === "visual" ? "max-sm:hidden vpdf-desk" : ""');
  });
});
