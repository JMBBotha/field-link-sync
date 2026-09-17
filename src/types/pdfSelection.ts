/**
 * Shared type & helpers for PDF-selected products.
 * Used across Normal, Visual, and Area builder tabs.
 */

export interface PdfSelectedProduct {
  /** Selection key — the overlay ROW id (each PDF row toggles independently). */
  code: string;
  description: string;
  price: string;
  quantity: number;
  unitType: string;
  costPrice?: number;
  markupPercent?: number;
  /** Real catalog product UUID when the row matched a live catalog product. */
  productId?: string;
  /** Human product code (SKU) from the catalog row. */
  productCode?: string;
  /** Catalog / PDF blurb, used as the seed for the quote line description. */
  pdfDescription?: string;
  supplierName?: string;
  /** Parsed from PDF row (AC catalogs): indoor model, outdoor model, BTU, kW */
  indoorModel?: string;
  outdoorModel?: string;
  btu?: string;
  kw?: string;
}

export type PdfSelectionState = PdfSelectedProduct[];

type SelectInput = Pick<PdfSelectedProduct, "code" | "description" | "price"> &
  Partial<
    Pick<
      PdfSelectedProduct,
      | "costPrice"
      | "markupPercent"
      | "productId"
      | "productCode"
      | "pdfDescription"
      | "supplierName"
      | "indoorModel"
      | "outdoorModel"
      | "btu"
      | "kw"
    >
  >;

export type PdfSelectionHandlers = {
  selectedFromPdf: PdfSelectionState;
  setSelectedFromPdf: React.Dispatch<React.SetStateAction<PdfSelectionState>>;
  handleSelectProduct: (product: SelectInput) => void;
  updateSelectedItem: (
    code: string,
    updates: Partial<
      Pick<PdfSelectedProduct, "quantity" | "unitType" | "costPrice" | "markupPercent" | "price" | "pdfDescription" | "description">
    >,
  ) => void;
};
