/**
 * AI Parser Service — thin client that calls the parse-pdf-with-grok edge function.
 * 
 * Usage:
 *   const products = await aiParsePdf(supplierId, file);
 */

import { supabase } from "@/integrations/supabase/client";
import type { ParsedProduct } from "@/services/productImportParser";

export interface AiParseResult {
  products: ParsedProduct[];
  warnings: string[];
  pageCount?: number;
}

/**
 * Send a PDF file to the AI parser edge function and return structured products.
 * The edge function handles conversion, prompting, and validation.
 */
export async function aiParsePdf(
  supplierId: string,
  file: File
): Promise<AiParseResult> {
  // Convert file to base64 for the edge function
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
  );

  const { data, error } = await supabase.functions.invoke("parse-pdf-with-grok", {
    body: {
      pdfBase64: base64,
      fileName: file.name,
      supplierId,
    },
  });

  if (error) {
    console.error("[aiParser] Edge function error:", error);
    throw new Error(`AI parse failed: ${error.message}`);
  }

  if (!data?.products || !Array.isArray(data.products)) {
    console.warn("[aiParser] Unexpected response shape:", data);
    return { products: [], warnings: ["AI returned no products"] };
  }

  return {
    products: data.products as ParsedProduct[],
    warnings: data.warnings || [],
    pageCount: data.pageCount,
  };
}
