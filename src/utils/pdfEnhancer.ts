import { supabase } from "@/integrations/supabase/client";

/**
 * Enhance PDF page images using the enhance-pdf-page edge function (Deep-Image.ai).
 * Falls back to original image on any failure.
 */
export async function enhancePDFPages(
  pageImages: string[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const enhanced: string[] = [];
  for (let i = 0; i < pageImages.length; i++) {
    try {
      const { data, error } = await supabase.functions.invoke("enhance-pdf-page", {
        body: { imageBase64: pageImages[i], width: 2000 },
      });
      if (!error && data?.enhancedBase64) {
        enhanced.push(data.enhancedBase64);
      } else {
        enhanced.push(pageImages[i]);
      }
    } catch {
      enhanced.push(pageImages[i]);
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
