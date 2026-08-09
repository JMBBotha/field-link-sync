import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { admin, corsHeaders, createNextOffer, escalate, json } from "../_shared/dispatch.ts";

/** Cron: expires stale offers and cascades to the next candidate. */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const db = admin();

    const { data: stale } = await db
      .from("offers")
      .select("id, lead_id, offer_type, sequence, staff_id")
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    if (!stale?.length) return json({ success: true, expired: 0 });

    await db
      .from("offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .in("id", stale.map((o: any) => o.id));

    let cascaded = 0;
    let escalated = 0;

    for (const offer of stale) {
      await db.from("notifications").insert({
        user_id: offer.staff_id,
        type: "offer_expired",
        title: "Offer expired",
        body: "A job offer expired before you responded and was passed on.",
        related_id: offer.id,
        metadata: { offer_id: offer.id, lead_id: offer.lead_id },
      });

      const result: any = await createNextOffer(db, {
        leadId: offer.lead_id,
        offerType: offer.offer_type,
        role: offer.offer_type === "sales_estimate" ? "sales_engineer" : "technician",
      });

      if (result.escalate) {
        await escalate(db, result.lead, "All candidates exhausted after offers expired");
        escalated++;
      } else if (result.offer) {
        cascaded++;
      }
    }

    return json({ success: true, expired: stale.length, cascaded, escalated });
  } catch (err) {
    console.error("[process-expired-offers]", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});
