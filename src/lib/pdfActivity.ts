import { supabase } from "@/integrations/supabase/client";

/**
 * POPIA trail: who downloaded / printed / sent a quote PDF, and when (Johan 29 Oct 2026).
 * Fire-and-forget: a logging failure must never block the user's PDF. Company and user
 * are filled in by the database (defaults + RLS), so nothing sensitive is passed here.
 */
export function logPdfActivity(quoteId: string | null | undefined, action: "download" | "send" | "print") {
  try {
    void (supabase.from as any)("pdf_activity")
      .insert({ quote_id: quoteId ?? null, action })
      .then(({ error }: { error: unknown }) => { if (error) console.warn("pdf_activity log skipped", error); });
  } catch (e) {
    console.warn("pdf_activity log skipped", e);
  }
}
