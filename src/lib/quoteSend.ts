import { supabase } from "@/integrations/supabase/client";
import { r0Quote, r0Msg } from "@/lib/zeroPriceGuard";

/**
 * Single Send prep for the whole app: ensures the quote has a public_token
 * (client link /quote/:token) and moves a draft to `sent` with `sent_at`.
 * Never touches accepted / declined / viewed statuses.
 * Used by both the quote builder and the estimate page — one send pipeline.
 */
export async function ensureQuoteReadyToSend(quoteId: string): Promise<void> {
  await assertQuotePriced(quoteId);
  const { data: q, error } = await supabase
    .from("quotes")
    .select("public_token, status, sent_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;

  const patch: Record<string, unknown> = {};
  if (!q?.public_token) patch.public_token = crypto.randomUUID();
  if (q?.status === "draft") {
    patch.status = "sent";
    patch.sent_at = new Date().toISOString();
  } else if (!q?.sent_at && q?.status !== "accepted" && q?.status !== "declined") {
    patch.sent_at = new Date().toISOString();
  }
  if (Object.keys(patch).length) {
    const { error: updateError } = await supabase.from("quotes").update(patch).eq("id", quoteId);
    if (updateError) throw updateError;
  }
}

export async function assertQuotePriced(id: string) {
  const { data, error } = await supabase.from("quote_items").select("item_name, unit_price, parent_item_id").eq("quote_id", id);
  if (error) throw error;
  const n = r0Quote((data || []) as any[]);
  if (n) throw new Error(r0Msg(n));
}
