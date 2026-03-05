import { supabase } from "@/integrations/supabase/client";

/**
 * Upload a base64 PNG image to Supabase Storage and return its public URL.
 * Returns null on failure so the caller can fall back gracefully.
 */
async function uploadPageToStorage(
  base64Data: string,
  pageIndex: number
): Promise<string | null> {
  try {
    const byteString = atob(base64Data);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "image/png" });

    const filePath = `temp/${crypto.randomUUID()}-page-${pageIndex}.png`;

    const { error: uploadError } = await supabase.storage
      .from("pdf-page-temps")
      .upload(filePath, blob, { contentType: "image/png", upsert: false });

    if (uploadError) {
      console.warn("[pdfEnhancer] Storage upload failed:", uploadError.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("pdf-page-temps")
      .getPublicUrl(filePath);

    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.warn("[pdfEnhancer] Storage upload error:", err);
    return null;
  }
}

/**
 * Clean up a temp image from storage after enhancement.
 */
async function deleteFromStorage(publicUrl: string) {
  try {
    // Extract file path from the public URL
    const marker = "/pdf-page-temps/";
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;
    const filePath = publicUrl.substring(idx + marker.length);
    await supabase.storage.from("pdf-page-temps").remove([filePath]);
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Enhance PDF page images using the enhance-pdf-page edge function (Deep-Image.ai).
 * Prefers URL-based workflow (upload to storage first) to avoid WORKER_LIMIT errors.
 * Falls back to base64 if storage upload fails, and to original image on any failure.
 */
export async function enhancePDFPages(
  pageImages: string[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const enhanced: string[] = [];
  for (let i = 0; i < pageImages.length; i++) {
    let storageUrl: string | null = null;
    try {
      // Try URL-based approach first
      storageUrl = await uploadPageToStorage(pageImages[i], i);

      const body: Record<string, unknown> = { width: 2000 };
      if (storageUrl) {
        body.imageUrl = storageUrl;
      } else {
        // Fallback to base64
        body.imageBase64 = pageImages[i];
      }

      const { data, error } = await supabase.functions.invoke("enhance-pdf-page", {
        body,
      });

      if (!error && data?.enhancedBase64) {
        enhanced.push(data.enhancedBase64);
      } else {
        enhanced.push(pageImages[i]);
      }
    } catch {
      enhanced.push(pageImages[i]);
    } finally {
      // Clean up temp file
      if (storageUrl) {
        deleteFromStorage(storageUrl);
      }
    }
    onProgress?.(i + 1, pageImages.length);
  }
  return enhanced;
}

/**
 * Render PDF pages to base64 PNG images using pdfjs-dist.
 */
export async function renderPDFToImages(
  file: File,
  scale: number = 2.0,
  onProgress?: (done: number, total: number) => void
): Promise<{ images: string[]; numPages: number; allText: string }> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];
  let allText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    // Extract text
    const textContent = await page.getTextContent();
    allText += textContent.items.map((item: any) => item.str).join(" ") + "\n";

    // Render to canvas
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/png").split(",")[1]);

    onProgress?.(pageNum, pdf.numPages);
  }

  return { images, numPages: pdf.numPages, allText };
}
