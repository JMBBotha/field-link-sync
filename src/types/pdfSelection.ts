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
}

export type PdfSelectionState = PdfSelectedProduct[];

export type PdfSelectionHandlers = {
  selectedFromPdf: PdfSelectionState;
  setSelectedFromPdf: React.Dispatch<React.SetStateAction<PdfSelectionState>>;
  handleSelectProduct: (product: Pick<PdfSelectedProduct, "code" | "description" | "price"> & Partial<Pick<PdfSelectedProduct, "costPrice" | "markupPercent">>) => void;
  updateSelectedItem: (code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType" | "costPrice" | "markupPercent" | "price">>) => void;
};
