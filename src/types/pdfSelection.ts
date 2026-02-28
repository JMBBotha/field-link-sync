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
}

export type PdfSelectionState = PdfSelectedProduct[];

export type PdfSelectionHandlers = {
  selectedFromPdf: PdfSelectionState;
  setSelectedFromPdf: React.Dispatch<React.SetStateAction<PdfSelectionState>>;
  handleSelectProduct: (product: Pick<PdfSelectedProduct, "code" | "description" | "price">) => void;
  updateSelectedItem: (code: string, updates: Partial<Pick<PdfSelectedProduct, "quantity" | "unitType">>) => void;
};
