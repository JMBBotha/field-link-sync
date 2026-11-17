import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import QuoteTermsPage from "@/components/quoting/QuoteTermsPage";
import { PDF_CAPTURE_WIDTH_PX, pinPdfCaptureSheet } from "@/lib/pdfCaptureLayout";

describe("PDF sheet stays the desktop layout on a phone", () => {
  it("renders terms in two columns when the viewport is 390px", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const rule = `[data-pdf-a4-sheet] .fl-terms-grid{grid-template-columns:repeat(2,minmax(0,1fr))}`;
    expect(readFileSync("src/index.css", "utf8")).toContain(rule);
    expect(readFileSync("src/lib/documentPdf.ts", "utf8")).toContain("pinPdfCaptureSheet");
    expect(readFileSync("src/lib/documentPdf.ts", "utf8")).toContain("windowWidth: win.windowWidth");
    const style = document.createElement("style");
    style.textContent = rule;
    document.head.appendChild(style);
    const { container } = render(
      <div data-pdf-a4-sheet="true" style={{ width: 390 }}>
        <QuoteTermsPage companyName="Massair CT (Pty) Ltd" quoteNumber="Q-2026-0099" rowFlow />
      </div>,
    );
    const row = container.querySelector("[data-testid='terms-row']") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.closest("[data-pdf-a4-sheet]")).toBeTruthy();
    const cols = getComputedStyle(row).gridTemplateColumns.replace(/\s/g, "");
    expect(cols).toContain("repeat(2,minmax(0,1fr))");
    expect(cols).not.toContain("repeat(1");
    style.remove();
  });

  it("pins the captured node to the desktop sheet width", () => {
    const parent = document.createElement("div");
    parent.style.width = "390px";
    const el = document.createElement("div");
    el.setAttribute("data-pdf-capture-root", "invoice");
    el.textContent = "sheet";
    parent.appendChild(el);
    document.body.appendChild(parent);
    const restore = pinPdfCaptureSheet(el);
    expect(el.getAttribute("data-pdf-a4-sheet")).toBe("true");
    expect(el.style.width).toBe(`${PDF_CAPTURE_WIDTH_PX}px`);
    expect(el.parentElement?.getAttribute("data-pdf-fixed-host")).toBe("true");
    expect(el.parentElement).not.toBe(parent);
    restore();
    expect(el.parentElement).toBe(parent);
    expect(el.getAttribute("data-pdf-a4-sheet")).toBeNull();
    parent.remove();
  });
});
