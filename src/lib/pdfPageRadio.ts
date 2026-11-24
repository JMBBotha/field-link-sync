/**
 * A Visual PDF radio is drawn on a supplier_pdf_pages row.
 * A product with a bbox and a page number still has no radio when that
 * book has no supplier_pdf_pages rows (Sir Air). Adding the page brings it back.
 */

export interface StoredPdfPage {
  id: string;
  page_number: number;
  pdf_upload_id?: string | null;
}

export interface StoredPdfRow {
  id: string;
  product_code?: string | null;
  short_name?: string | null;
  description?: string | null;
  page_number?: number | null;
  pdf_upload_id?: string | null;
  row_bbox?: { x?: number; y?: number; width?: number; height?: number } | null;
}

export interface StoredRadioRegion {
  id: string;
  pageId: string;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  product_code: string;
  label: string;
}

export function radioRegionForStoredRow(
  pages: StoredPdfPage[],
  row: StoredPdfRow,
): StoredRadioRegion | null {
  if (row.page_number == null || !row.row_bbox || typeof row.row_bbox !== "object") return null;
  const page = pages.find((p) => {
    if (Number(p.page_number) !== Number(row.page_number)) return false;
    if (row.pdf_upload_id && p.pdf_upload_id && row.pdf_upload_id !== p.pdf_upload_id) return false;
    return true;
  });
  if (!page) return null;
  const y = Number(row.row_bbox.y ?? 0);
  const h = Number(row.row_bbox.height ?? 0.02);
  const x = Number(row.row_bbox.x ?? 0);
  const w = Number(row.row_bbox.width ?? 1);
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || h <= 0 || w <= 0) return null;
  return {
    id: `ocr-${page.id}-${row.id}`,
    pageId: page.id,
    x_pct: x * 100,
    y_pct: y * 100,
    w_pct: w * 100,
    h_pct: h * 100,
    product_code: row.product_code || "",
    label: row.short_name || row.description || row.product_code || "",
  };
}
