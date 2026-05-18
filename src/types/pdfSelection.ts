/**
 * Shared type & helpers for PDF-selected products.
 * Used across Normal, Visual, and Area builder tabs.
 */

export interface PdfSelectedProduct {
  code: string;
  description: string;
  price: string;
  quantity: number;
  unitType: string;
  costPrice?: number;
  markupPercent?: number;
  /** Parsed from PDF row (AC catalogs): indoor model, outdoor model, BTU, kW */
  indoorModel?: string;
  outdoorModel?: string;
  btu?: string;
  kw?: string;
}

export type PdfSelectionState = PdfSelectedProduct[];

type SelectInput = Pick<PdfSelectedProduct, "code" | "description" | "price"> &
  Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent" | "indoorModel" | "outdoorModel" | "btu" | "kw">>;

export type PdfSelectionHandlers = {
  selectedFromPdf: PdfSelectionState;
  setSelectedFromPdf: React.Dispatch<React.SetStateAction<PdfSelectionState>>;
  handleSelectProduct: (product: SelectInput) => void;
  updateSelectedItem: (code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType" | "costPrice" | "markupPercent" | "price">>) => void;
};
