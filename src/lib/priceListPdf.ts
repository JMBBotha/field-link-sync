/** Price list PDF sources (pdf_uploads) for the quote builder's side panel. */
export const PRICE_LIST_BUCKETS = ["supplier-pdf-pages", "supplier-pdfs", "stock-documents", "price-lists", "pdfs"] as const;
export const PRICE_LIST_PREF_KEY = "fl-quote-pricelist";

export type PriceListRow = {
  id: string;
  supplier_id: string;
  file_name: string;
  brand: string | null;
  file_path: string | null;
  storage_path: string | null;
  file_url: string | null;
  price_list_type: string | null;
};

export type StorageCandidate = { bucket: string; path: string };

/** Bucket/path pairs to try for a signed URL, most specific first. Never a public URL. */
export function priceListCandidates(row: PriceListRow): StorageCandidate[] {
  const out: StorageCandidate[] = [];
  const seen = new Set<string>();
  const push = (bucket: string, path: string) => {
    const k = `${bucket}/${path}`;
    if (!path || seen.has(k)) return;
    seen.add(k);
    out.push({ bucket, path });
  };
  for (const v of [row.file_path, row.storage_path, row.file_url].filter(Boolean) as string[]) {
    if (/^https?:\/\//i.test(v)) {
      const m = v.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
      if (m) push(m[1], decodeURIComponent(m[2]));
      continue;
    }
    const clean = v.replace(/^\/+/, "");
    for (const b of PRICE_LIST_BUCKETS) push(b, clean);
  }
  if (row.supplier_id && row.file_name) for (const b of PRICE_LIST_BUCKETS) push(b, `${row.supplier_id}/${row.file_name}`);
  return out;
}

/** Picker label: "Supplier · brand · file". */
export function priceListLabel(row: PriceListRow, supplierName?: string | null): string {
  const parts = [supplierName, row.brand, row.file_name.replace(/\.pdf$/i, "")].filter((p) => p && String(p).trim());
  return Array.from(new Set(parts as string[])).join(" · ");
}

/**
 * Supplier price list PDFs show supplier (cost-basis) prices: the importer reads the PDF price
 * straight into cost_price. So only admins may open them from a quote; sales reps and technicians never.
 */
export function canSeePriceListPdfs(roles: string[]): boolean {
  return roles.includes("admin");
}

/** Viewer zoom bounds (1 = fit to width). */
export function clampZoom(z: number): number {
  return Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
}
