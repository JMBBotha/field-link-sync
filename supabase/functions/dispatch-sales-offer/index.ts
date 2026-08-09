import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { admin, corsHeaders, createNextOffer, escalate, json, DEFAULT_RADIUS_KM } from "../_shared/dispatch.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { lead_id, radius_km } = await req.json();
    if (!lead_id) return json({ error: "lead_id is required" }, 400);

    const db = admin();
    const result: any = await createNextOffer(db, {
      leadId: lead_id,
      offerType: "sales_estimate",
      role: "sales_engineer",
      radiusKm: Number(radius_km) || DEFAULT_RADIUS_KM,
    });

    if (result.error) return json({ error: result.error }, result.status ?? 500);

    if (result.escalate) {
      await escalate(db, result.lead, "No available sales engineer within radius");
      return json({ success: false, escalated: true, message: "No candidates; admin notified" });
    }

    await db.from("leads").update({ lead_status: "routed" }).eq("id", lead_id);

    return json({
      success: true,
      offer_id: result.offer.id,
      staff_id: result.candidate.staff_id,
      distance_km: result.candidate.distance_km,
      expires_at: result.offer.expires_at,
    });
  } catch (err) {
    console.error("[dispatch-sales-offer]", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});
