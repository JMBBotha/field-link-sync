/**
 * Captures PDF pages as images and uploads them to Supabase Storage.
 * Used during PDF import to build the visual catalog.
 */
import { supabase } from "@/integrations/supabase/client";

/** Load pdf.js from CDN lazily (shared with SupplierProductImporter) */
let pdfJsLoadPromise: Promise<any> | null = null;
export function loadPdfJs(): Promise<any> {
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(lib);
    };
    script.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(script);
  });
  return pdfJsLoadPromise;
}

interface CaptureResult {
  pagesStored: number;
  errors: number;
}

/**
 * Scan a rendered page canvas for the pink-marked price column.
 * Returns the x-range as fractions of canvas width, or null if no clear band found.
 * Pink = saturated magenta/pink (R high, G low, B high-ish; R > G + 40).
 */
function detectPinkColumn(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { x_frac: number; w_frac: number } | null {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const cols = new Uint32Array(w);
    const stepX = 2; // sample every 2px for speed
    const stepY = 4;
    for (let y = 0; y < h; y += stepY) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += stepX) {
        const i = row + x * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Pink/magenta highlight heuristic — tuned for marker-pen pink rectangles.
        if (r > 200 && g < 180 && b > 130 && r - g > 40 && r - b > -10) {
          cols[x]++;
        }
      }
    }
    // Find x positions with meaningful pink mass.
    const total = cols.reduce((a, b) => a + b, 0);
    if (total < 50) return null;
    const max = Math.max(...cols);
    const threshold = Math.max(3, max * 0.15);
    let minX = -1, maxX = -1;
    for (let x = 0; x < w; x++) {
      if (cols[x] >= threshold) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    if (minX < 0 || maxX <= minX) return null;
    // Reject if band is the whole page (>70% width) — likely not a column mark.
    const widthFrac = (maxX - minX) / w;
    if (widthFrac > 0.7) return null;
    return { x_frac: minX / w, w_frac: widthFrac };
  } catch {
    return null;
  }
}

/**
 * Render each page of a PDF to a canvas, convert to JPEG,
 * upload to Supabase Storage, and insert rows into supplier_pdf_pages.
 */
export async function capturePdfPages(
  file: File,
  supplierName: string,
  onProgress?: (current: number, total: number) => void,
  /** Optional supplierId to use as storage folder key (falls back to supplierName) */
  supplierId?: string,
  /** Optional brand tag (e.g. Samsung / Alliance) for multi-brand suppliers */
  brand?: string | null,
): Promise<CaptureResult> {
  console.log("[PDF Capture] Loading pdfjs...");
  const pdfjsLib = await loadPdfJs();
  console.log("[PDF Capture] Reading file ArrayBuffer...");
  const arrayBuffer = await file.arrayBuffer();
  console.log(`[PDF Capture] ArrayBuffer size: ${arrayBuffer.byteLength}`);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  console.log(`[PDF Capture] PDF loaded, ${pdf.numPages} pages`);
  const numPages = pdf.numPages;

  let pagesStored = 0;
  let errors = 0;
  const SCALE = 2.25;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    onProgress?.(pageNum, numPages);
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d", { alpha: false })!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Detect pink-marked price column BEFORE converting to JPEG
      const pink = detectPinkColumn(ctx, canvas.width, canvas.height);
      if (pink) {
        console.log(`[PDF Capture] Page ${pageNum}: pink column at x=${(pink.x_frac * 100).toFixed(1)}% w=${(pink.w_frac * 100).toFixed(1)}%`);
      }

      // Convert canvas to JPEG blob
      let blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob(
          (b) => resolve(b!),
          "image/jpeg",
          0.93
        );
      });

      // Upload to storage
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const folderKey = supplierId || supplierName;
      const storagePath = `${folderKey}/${safeName}/page-${pageNum}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("supplier-pdf-pages")
        .upload(storagePath, blob, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error(`[PDF Capture] Upload error page ${pageNum}:`, uploadError);
        errors++;
        continue;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("supplier-pdf-pages")
        .getPublicUrl(storagePath);

      // Insert into supplier_pdf_pages table
      const { error: insertError } = await (supabase.from("supplier_pdf_pages") as any).insert({
        supplier_id: supplierId || supplierName,
        pdf_filename: file.name,
        page_number: pageNum,
        page_image_url: urlData.publicUrl,
        price_column_bbox: pink ? { x_frac: pink.x_frac, w_frac: pink.w_frac } : null,
        brand: brand || null,
      });

      if (insertError) {
        console.error(`[PDF Capture] DB insert error page ${pageNum}:`, insertError);
        errors++;
        continue;
      }

      pagesStored++;

      // Cleanup canvas
      canvas.width = 0;
      canvas.height = 0;
    } catch (err) {
      console.error(`[PDF Capture] Error processing page ${pageNum}:`, err);
      errors++;
    }
  }

  // Optional: upload original PDF for live text extraction overlays (non-blocking)
  if (pagesStored > 0) {
    try {
      const safePdfName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const folderKeyPdf = supplierId || supplierName;
      const pdfStoragePath = `${folderKeyPdf}/${safePdfName}`;
      const { error: pdfUploadErr } = await supabase.storage
        .from("supplier-pdf-pages")
        .upload(pdfStoragePath, file, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (!pdfUploadErr) {
        const { data: pdfUrlData } = supabase.storage
          .from("supplier-pdf-pages")
          .getPublicUrl(pdfStoragePath);
        // Update all page records with the PDF storage path
        await (supabase.from("supplier_pdf_pages") as any)
          .update({ pdf_storage_path: pdfUrlData.publicUrl })
          .eq("supplier_id", supplierId || supplierName)
          .eq("pdf_filename", file.name);
        console.log("[PDF Capture] Original PDF linked for live overlays");
      } else {
        console.warn("[PDF Capture] Optional PDF upload failed (non-blocking):", pdfUploadErr);
      }
    } catch (e) {
      console.warn("[PDF Capture] Optional PDF upload error (non-blocking):", e);
    }
  }

  return { pagesStored, errors };
}

/**
 * After products are imported, match them to PDF pages and create regions.
 * This links product codes found in the import to the pages they came from.
 */
export async function matchProductsToPdfPages(
  supplierName: string,
  pdfFilename: string,
  productCodes: string[]
): Promise<number> {
  if (productCodes.length === 0) return 0;

  // Get all pages for this PDF
  const { data: pages } = await (supabase.from("supplier_pdf_pages") as any)
    .select("id, page_number")
    .eq("supplier_id", supplierName)
    .eq("pdf_filename", pdfFilename)
    .order("page_number");

  if (!pages || pages.length === 0) return 0;

  // Get products matching these codes
  const { data: products } = await (supabase.from("supplier_products") as any)
    .select("id, product_code")
    .in(
      "product_code",
      productCodes.map((c) => c.toUpperCase())
    );

  if (!products || products.length === 0) return 0;

  // For simplicity, assign products to the first page (can be refined later)
  // and create region entries
  const firstPageId = pages[0].id;
  let matched = 0;

  for (const product of products) {
    const { error } = await (supabase.from("pdf_product_regions") as any).insert({
      pdf_page_id: firstPageId,
      product_id: product.id,
      product_code: product.product_code,
      label: product.product_code,
      auto_matched: true,
    });
    if (!error) matched++;
  }

  return matched;
}
