import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PdfPageOverlay from "@/components/catalog/quote-builder/PdfPageOverlay";
import { productForPageRegion } from "@/lib/pdfPageProduct";
import { radioRegionForStoredRow, type StoredPdfRow } from "@/lib/pdfPageRadio";

// Sir Air rows have a bbox, but the book had no supplier_pdf_pages, so no radio.
const ROW: StoredPdfRow = {
  id: "sir-row",
  product_code: "SA-INC-12",
  short_name: "Sir Air 12k cassette",
  page_number: 4,
  pdf_upload_id: "sir-book",
  row_bbox: { x: 0.05, y: 0.42, width: 0.9, height: 0.02 },
};

describe("PDF radio needs a supplier_pdf_pages row", () => {
  it("draws the radio only after the missing page row exists", () => {
    expect(radioRegionForStoredRow([], ROW)).toBeNull();

    const region = radioRegionForStoredRow(
      [{ id: "page-4", page_number: 4, pdf_upload_id: "sir-book" }],
      ROW,
    );
    expect(region).not.toBeNull();
    expect(region!.y_pct).toBeCloseTo(42);
    expect(region!.pageId).toBe("page-4");

    const product = productForPageRegion({
      id: ROW.id,
      product_code: ROW.product_code,
      short_name: ROW.short_name,
      cost_excl_vat: 2500,
      default_markup_percent: 35,
    }, null);

    render(
      <PdfPageOverlay
        regions={[{
          id: region!.id,
          x_pct: region!.x_pct,
          y_pct: region!.y_pct,
          w_pct: region!.w_pct,
          h_pct: region!.h_pct,
          product,
          product_code: region!.product_code,
          label: region!.label,
          matched: true,
        }]}
        baskets={[]}
        favoriteIds={new Set()}
        pdfSelection={{
          selectedFromPdf: [],
          setSelectedFromPdf: () => undefined,
          updateSelectedItem: () => undefined,
          handleSelectProduct: () => undefined,
        }}
      />,
    );

    expect(screen.getByTestId("pdf-margin-hit-strip")).toBeInTheDocument();
    expect(document.querySelector("[data-pdf-region-box]")?.getAttribute("data-pdf-state")).toBe("normal");
  });
});
