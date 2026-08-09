import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { admin, corsHeaders, createNextOffer, escalate, json } from "../_shared/dispatch.ts";

/**
 * decline-offer — records a decline and immediately cascades the lead to the
 * next candidate. Without this the cascade only ever happened on expiry, so a
 * declined lead sat idle with no pending offer until an admin noticed.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { offer_id } = await req.json();
    if (!offer_id) return json({ error: "offer_id is required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return json({ error: "Not authenticated" }, 401);

    const db = admin();
    const { data: offer } = await db
      .from("offers")
      .select("id, lead_id, staff_id, offer_type, status")
      .eq("id", offer_id)
      .maybeSingle();
    if (!offer) return json({ error: "Offer not found" }, 404);
    if (offer.staff_id !== callerId) {
      return json({ error: "Cannot decline an offer belonging to another user" }, 403);
    }
    if (offer.status !== "pending") {
      return json({ error: "Offer is no longer pending" }, 409);
    }

    await db
      .from("offers")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", offer_id)
      .eq("status", "pending");

    const result: any = await createNextOffer(db, {
      leadId: offer.lead_id,
      offerType: offer.offer_type,
      role: offer.offer_type === "sales_estimate" ? "sales_engineer" : "technician",
    });

    if (result.escalate) {
      await escalate(db, result.lead, "All candidates declined or exhausted");
      return json({ success: true, escalated: true });
    }
    if (result.error) return json({ success: true, cascaded: false, message: result.error });

    return json({ success: true, cascaded: true, offer_id: result.offer.id });
  } catch (err) {
    console.error("[decline-offer]", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});
