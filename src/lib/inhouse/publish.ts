import { supabase } from "@/integrations/supabase/client";
import { buildInhousePricebook, type BookItem } from "./pricebookPdf";

/**
 * Publish the One Stop Shop in-house price book (2026-10-09).
 * 1. pdf-lib builds the PDF (exact row/price boxes)  2. pdf.js renders each page to JPEG
 * 3. PDF -> supplier-pdfs, JPEGs -> supplier-pdf-pages  4. publish_inhouse_book RPC swaps the book
 *    and writes every item in ONE transaction (RLS: master-catalogue admins only).
 * A failure before step 4 only leaves unused files; the live book never ends half-written.
 */
export const INHOUSE_BRAND = "In-house";

export interface PublishItem extends BookItem {
  id?: string | null;          // supplier_products.id (absent = new)
  archived?: boolean;
  family: string; type_code: string; size_code?: string | null; variant?: string | null;
}

export const inhouseFileName = (version: number) => `One_Stop_Shop_x_In-house_Items_v${version}.pdf`;

async function renderPagesToJpeg(bytes: Uint8Array): Promise<Blob[]> {
  const pdfjsLib: any = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const out: Blob[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    const vp = pg.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Page render failed"))), "image/jpeg", 0.88));
    out.push(blob);
  }
  return out;
}

export async function nextInhouseVersion(supplierId: string): Promise<number> {
  const { count, error } = await (supabase.from("pdf_uploads") as any)
    .select("id", { count: "exact", head: true }).eq("supplier_id", supplierId).eq("price_list_type", "in_house");
  if (error) throw error;
  return (count ?? 0) + 1;
}

export async function publishInhouseBook(args: { supplierId: string; supplierName?: string; items: PublishItem[] }): Promise<{ uploadId: string; version: number; pdfUrl: string }> {
  const { supplierId, items } = args;
  const live = items.filter((i) => !i.archived);
  const version = await nextInhouseVersion(supplierId);
  const date = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  const book = await buildInhousePricebook(live, { version, date, supplierName: args.supplierName });
  const fileName = inhouseFileName(version);
  const folder = `${supplierId}/in-house`;

  const pdfPath = `${folder}/${fileName}`;
  const up = await supabase.storage.from("supplier-pdfs").upload(pdfPath, new Blob([new Uint8Array(book.bytes)], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) throw new Error(`PDF upload failed: ${up.error.message}`);
  const pdfUrl = supabase.storage.from("supplier-pdfs").getPublicUrl(pdfPath).data.publicUrl;

  const jpgs = await renderPagesToJpeg(book.bytes);
  const pages: any[] = [];
  for (let i = 0; i < jpgs.length; i++) {
    const p = `${folder}/${fileName}/page-${i + 1}.jpg`;
    const r = await supabase.storage.from("supplier-pdf-pages").upload(p, jpgs[i], { upsert: true, contentType: "image/jpeg" });
    if (r.error) throw new Error(`Page image upload failed: ${r.error.message}`);
    pages.push({ page_number: i + 1, page_image_url: supabase.storage.from("supplier-pdf-pages").getPublicUrl(p).data.publicUrl, price_column_bbox: book.priceColumn });
  }

  const payload = items.map((i) => {
    const l = book.layout[i.key];
    return {
      id: i.id || null, archived: !!i.archived, sku_code: i.sku_code, name: i.name, description: i.description || null,
      category: i.category, cost: i.cost, per_metre: i.per_metre, unit_length: i.per_metre ? i.unit_length : null,
      family: i.family, type_code: i.type_code, size_code: i.size_code || null, variant: i.variant || null,
      page_number: l?.page_number ?? null, row_bbox: l?.row_bbox ?? null, price_bbox: l?.price_bbox ?? null,
    };
  });
  const { data, error } = await (supabase.rpc as any)("publish_inhouse_book", {
    p_supplier_id: supplierId, p_file_name: fileName, p_pdf_url: pdfUrl, p_storage_path: pdfPath, p_pages: pages, p_items: payload,
  });
  if (error) throw new Error(error.message || "Save rejected");
  return { uploadId: data as string, version, pdfUrl };
}
