import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  canOfferCreditNote,
  companyBlocksDocumentEdits,
  invoicePreviewChoices,
  previewClickOpensChoice,
  quotePreviewChoices,
} from "@/lib/documentPreviewChoices";
import DocumentChoiceDialog from "@/components/documents/DocumentChoiceDialog";
import PreviewClickSurface from "@/components/documents/PreviewClickSurface";

describe("invoice preview choices", () => {
  it("offers Edit invoice on a writable draft", () => {
    expect(invoicePreviewChoices({ status: "draft", companyWritable: true, canCreditNote: false })).toEqual([
      { id: "edit", label: "Edit invoice", primary: true },
    ]);
  });

  it("offers the existing locked actions on a sent invoice, and credit note only when that button exists", () => {
    expect(invoicePreviewChoices({ status: "sent", companyWritable: true, canCreditNote: true }).map((c) => c.id)).toEqual(["duplicate", "credit-note"]);
    expect(invoicePreviewChoices({ status: "overdue", companyWritable: true, canCreditNote: false }).map((c) => c.id)).toEqual(["duplicate"]);
    expect(invoicePreviewChoices({ status: "void", companyWritable: true, canCreditNote: true }).map((c) => c.id)).toEqual(["duplicate"]);
  });

  it("offers nothing on an archived or on-hold company, including a draft", () => {
    expect(companyBlocksDocumentEdits("archived", true)).toBe(true);
    expect(companyBlocksDocumentEdits("on_hold", true)).toBe(true);
    expect(companyBlocksDocumentEdits("active", true)).toBe(false);
    expect(companyBlocksDocumentEdits(null, true)).toBe(false);
    expect(companyBlocksDocumentEdits("archived", false)).toBe(false);
    expect(invoicePreviewChoices({ status: "draft", companyWritable: false, canCreditNote: false })).toEqual([]);
    expect(invoicePreviewChoices({ status: "sent", companyWritable: false, canCreditNote: true })).toEqual([]);
  });

  it("matches the credit-note panel: not a draft, balance still open, not a sales rep", () => {
    expect(canOfferCreditNote({ status: "sent", isSalesRep: false, outstanding: 10 })).toBe(true);
    expect(canOfferCreditNote({ status: "draft", isSalesRep: false, outstanding: 10 })).toBe(false);
    expect(canOfferCreditNote({ status: "sent", isSalesRep: true, outstanding: 10 })).toBe(false);
    expect(canOfferCreditNote({ status: "paid", isSalesRep: false, outstanding: 0 })).toBe(false);
  });
});

describe("quote preview choices", () => {
  const locked = { companyWritable: true, canEdit: false, canUnlock: true, canRelock: false, canVariation: true, canCorrectClient: true, lockActionsLive: true };
  it("offers edit and the full builder while the quote can change", () => {
    expect(quotePreviewChoices({ ...locked, canEdit: true }).map((c) => c.id)).toEqual(["edit", "full-builder"]);
  });
  it("offers only the lock-banner actions once the quote is locked", () => {
    expect(quotePreviewChoices(locked).map((c) => c.id)).toEqual(["unlock", "variation", "client"]);
    expect(quotePreviewChoices({ ...locked, lockActionsLive: false })).toEqual([]);
  });
  it("offers nothing for an archived company", () => {
    expect(quotePreviewChoices({ ...locked, companyWritable: false, canEdit: true })).toEqual([]);
  });
});

describe("preview clicks", () => {
  it("opens on the page and leaves links and buttons alone", () => {
    const onOpen = vi.fn();
    render(
      <PreviewClickSurface enabled label="Invoice options" onOpen={onOpen}>
        <div>
          <p>Invoice body</p>
          <a href="/client">Client</a>
          <button type="button">Company details</button>
          <span role="textbox" contentEditable>Line name</span>
        </div>
      </PreviewClickSurface>,
    );
    fireEvent.click(screen.getByText("Invoice body"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Client"));
    fireEvent.click(screen.getByText("Company details"));
    fireEvent.click(screen.getByText("Line name"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const surface = screen.getByTestId("document-preview-surface");
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByText("Company details"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("does not treat a click outside the surface as an open", () => {
    const surface = document.createElement("div");
    const inside = document.createElement("p");
    const link = document.createElement("a");
    surface.append(inside, link);
    expect(previewClickOpensChoice(inside, surface)).toBe(true);
    expect(previewClickOpensChoice(link, surface)).toBe(false);
    expect(previewClickOpensChoice(document.body, surface)).toBe(false);
  });
});

describe("document pages wire the choice", () => {
  it("puts Edit invoice at the top of a draft and opens the same editor from the preview", () => {
    const page = readFileSync("src/components/invoicing/InvoiceDetailPage.tsx", "utf8");
    expect(page).toContain('data-testid="invoice-edit-top"');
    expect(page).toContain('testId="invoice-preview-surface"');
    expect(page).toContain('data-testid="invoice-edit-bottom"');
    expect(page).toContain("invoicePreviewChoices");
  });
  it("puts Full builder at the top of an editable quote and opens the choice from the preview", () => {
    const page = readFileSync("src/pages/admin/AdminEstimateDetailPage.tsx", "utf8");
    const builder = readFileSync("src/components/quoting/EstimateBuilder.tsx", "utf8");
    expect(page).toContain('data-testid="quote-edit-top"');
    expect(page).toContain("quotePreviewChoices");
    expect(builder).toContain('testId="quote-preview-surface"');
    expect(builder).toContain('data-testid="quote-locked-surface"');
  });
});

describe("choice dialog", () => {
  it("runs the chosen action", () => {
    const onSelect = vi.fn();
    render(
      <DocumentChoiceDialog
        open
        onOpenChange={() => {}}
        title="Draft invoice"
        choices={[{ id: "edit", label: "Edit invoice", primary: true }, { id: "duplicate", label: "Duplicate" }]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("heading", { name: "Draft invoice" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("document-choice-edit"));
    expect(onSelect).toHaveBeenCalledWith("edit");
    fireEvent.click(screen.getByTestId("document-choice-duplicate"));
    expect(onSelect).toHaveBeenCalledWith("duplicate");
  });
});
