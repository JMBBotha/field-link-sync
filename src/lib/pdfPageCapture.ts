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
 * Render each page of a PDF to a canvas, convert to JPEG,
 * upload to Supabase Storage, and insert rows into supplier_pdf_pages.
 */
export async function capturePdfPages(
  file: File,
  supplierName: string,
  onProgress?: (current: number, total: number) => void,
  /** Optional supplierId to use as storage folder key (falls back to supplierName) */
  supplierId?: string,
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
        supplier_id: supplierName,
        pdf_filename: file.name,
        page_number: pageNum,
        page_image_url: urlData.publicUrl,
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
      const pdfStoragePath = `${supplierName}/${safePdfName}`;
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
          .eq("supplier_id", supplierName)
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
