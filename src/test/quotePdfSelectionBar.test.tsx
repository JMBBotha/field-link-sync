import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import QuotePdfSelectionBar from "@/components/quoting/QuotePdfSelectionBar";

describe("Quote PDF selection bar", () => {
  it("shows Download PDF (n) and calls through", () => {
    const onDownload = vi.fn();
    render(<QuotePdfSelectionBar selectedCount={5} quoteCount={5} busy={false} progress={null} onDownload={onDownload} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("download-quote-pdfs"));
    expect(screen.getByTestId("download-quote-pdfs").textContent).toMatch(/Download PDF \(5\)/);
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("shows preparing progress and keeps the button from starting again", () => {
    const onDownload = vi.fn();
    render(<QuotePdfSelectionBar selectedCount={5} quoteCount={5} busy progress={{ current: 3, total: 5 }} onDownload={onDownload} onCancel={() => {}} />);
    expect(screen.getByTestId("bulk-pdf-progress").textContent).toBe("Preparing 3 of 5…");
    expect(screen.getByTestId("download-quote-pdfs")).toBeDisabled();
    fireEvent.click(screen.getByTestId("download-quote-pdfs"));
    expect(onDownload).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-pdf-cancel")).toBeTruthy();
  });

  it("stops above the cap and when the tick is only a proposal", () => {
    const { rerender } = render(<QuotePdfSelectionBar selectedCount={51} quoteCount={51} busy={false} progress={null} onDownload={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("download-quote-pdfs")).toBeDisabled();
    expect(screen.getByTestId("quotes-selection-bar").textContent).toMatch(/50 or fewer/);
    rerender(<QuotePdfSelectionBar selectedCount={1} quoteCount={0} proposalNote="Proposals are left out of the PDF" busy={false} progress={null} onDownload={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("download-quote-pdfs")).toBeDisabled();
    expect(screen.getByTestId("quotes-selection-bar").textContent).toMatch(/Proposals are left out/);
  });
});
