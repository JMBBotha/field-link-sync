import { supabase } from "@/integrations/supabase/client";
import type { BrochureAttachment } from "./pdfMerger";
import { resolveAr40SalesCards } from "./ar40SalesCards";

interface BrochureRow {
  id: string;
  name: string;
  file_url: string;
  model_match_prefixes: string[] | null;
  sort_order: number | null;
  is_active: boolean | null;
}

export interface QuotePdfExtras {
  brochures: BrochureAttachment[];
  /** Sales-card PNG URLs, only used when no PDF brochure is attached. */
  imagePages: string[];
}

/**
 * Brochures to append to the client quote PDF, read at generate time.
 * 1. The quote's current attached list (respects staff remove/manual add).
 * 2. If nothing is attached yet, auto-match once on line-item model codes
 *    (same prefix rule as useQuoteBrochures) and persist the links.
 * Placeholder/missing files are skipped later by assembleQuoteWithBrochures.
 */
export async function loadQuoteBrochuresForPdf(quoteId?: string | null): Promise<QuotePdfExtras> {
  const empty: QuotePdfExtras = { brochures: [], imagePages: [] };
  if (!quoteId) return empty;
  try {
    const { data: items } = await supabase
      .from("quote_items")
      .select("item_number")
      .eq("quote_id", quoteId);
    const codes = (items || []).map((i: any) => String(i.item_number || "")).filter(Boolean);

    const { data: linked } = await supabase
      .from("quote_brochures" as never)
      .select("id, sort_order, brochure:product_brochures(*)")
      .eq("quote_id", quoteId)
      .order("sort_order");
    let rows = ((linked || []) as any[]).map((r) => r.brochure as BrochureRow).filter((b) => b && b.is_active !== false);

    if (rows.length === 0 && codes.length > 0 && (linked || []).length === 0) {
      const { data: all } = await supabase
        .from("product_brochures" as never)
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      const matched = ((all || []) as unknown as BrochureRow[]).filter((b) =>
        (b.model_match_prefixes || []).some((p) =>
          codes.some((c) => c.toUpperCase().trim().startsWith(p.toUpperCase().trim())),
        ),
      );
      rows = matched;
      if (matched.length) {
        await supabase.from("quote_brochures" as never).insert(
          matched.map((b, i) => ({ quote_id: quoteId, brochure_id: b.id, is_auto_matched: true, sort_order: i })) as never,
        );
      }
    }

    const brochures = rows.map((b) => ({ id: b.id, name: b.name, file_url: b.file_url }));
    const imagePages = brochures.length === 0 ? resolveAr40SalesCards(codes).map((c) => c.url) : [];
    return { brochures, imagePages };
  } catch (e) {
    console.warn("[quoteBrochuresForPdf] skipped brochures", e);
    return empty;
  }
}
