import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * auto-assign-lead v2 — BROADCAST MODEL
 *
 * Instead of picking one agent, this broadcasts the lead to ALL nearby
 * available agents. First to accept wins. The rest get expired.
 *
 * Flow:
 *   1. Lead created with coordinates
 *   2. This function broadcasts to all agents within radius
 *   3. Each agent gets a WhatsApp + in-app notification
 *   4. Agent taps "Accept" in the app → accept_lead() RPC
 *   5. All other offers expire
 *   6. If agent drops/releases → release_lead() RPC → back to pool + admin alert
 *
 * POST body:
 * {
 *   lead_id: string (required)
 *   radius_km?: number (default 30)
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "27" + digits.slice(1);
  } else if (!digits.startsWith("27") && digits.length === 9) {
    digits = "27" + digits;
  }
  return "+" + digits;
}

async function sendWhatsApp(
  phone: string,
  body: string,
): Promise<boolean> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioWhatsApp = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioWhatsApp) return false;

  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/\D/g, "");

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: `whatsapp:${twilioWhatsApp}`,
          To: `whatsapp:+${digits}`,
          Body: body,
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");
    if (!expectedKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { lead_id, radius_km = 30 } = body;

    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get lead details for the notification message
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, customer_name, customer_phone, customer_address, service_type, priority, status, latitude, longitude, assigned_agent_id, scheduled_date")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already accepted
    if (lead.assigned_agent_id) {
      return new Response(JSON.stringify({
        success: true,
        message: "Lead already assigned",
        skipped: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if no coordinates
    if (!lead.latitude || lead.latitude === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "Lead has no coordinates — will broadcast when address confirmed",
        skipped: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Broadcast to nearby agents ───
    console.log(`[broadcast] Lead ${lead_id}: broadcasting within ${radius_km}km`);

    const { data: offers, error: broadcastError } = await supabase
      .rpc("broadcast_lead_to_agents", {
        p_lead_id: lead_id,
        p_radius_km: radius_km,
      });

    if (broadcastError) {
      console.error("[broadcast] Error:", broadcastError);
      return new Response(JSON.stringify({
        success: false,
        error: "Broadcast failed",
        detail: broadcastError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const offerCount = offers?.length || 0;
    console.log(`[broadcast] ${offerCount} agents notified`);

    // Update lead with offer count
    await supabase
      .from("leads")
      .update({
        offer_count: offerCount,
        broadcast_radius_km: radius_km,
        assignment_method: "broadcast",
      })
      .eq("id", lead_id);

    // ─── Notify each agent ───
    const isUrgent = lead.priority === "high";
    const scheduledText = lead.scheduled_date
      ? `Scheduled: ${lead.scheduled_date}`
      : "ASAP";

    let notificationsSent = 0;

    for (const offer of (offers || [])) {
      const distText = offer.distance_km
        ? `${offer.distance_km.toFixed(1)}km away`
        : "";

      // WhatsApp notification
      const msgBody = [
        isUrgent ? `🚨 URGENT lead nearby!` : `🔔 New lead available!`,
        ``,
        `Customer: ${lead.customer_name || "New customer"}`,
        `Service: ${lead.service_type || "General"}`,
        lead.customer_address ? `Area: ${lead.customer_address}` : "",
        distText ? `Distance: ${distText}` : "",
        `When: ${scheduledText}`,
        ``,
        `Open FieldLink Sync to accept this lead.`,
        `First to accept gets it!`,
      ].filter(Boolean).join("\n");

      // Get agent phone
      const { data: agentProfile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", offer.agent_id)
        .single();

      if (agentProfile?.phone) {
        const sent = await sendWhatsApp(agentProfile.phone, msgBody);
        if (sent) notificationsSent++;
      }

      // In-app notification (always)
      await supabase.from("notifications").insert({
        user_id: offer.agent_id,
        title: isUrgent ? "🚨 Urgent Lead Nearby" : "New Lead Available",
        body: `${lead.customer_name || "Customer"} — ${lead.service_type || "General"}. ${distText}. Tap to accept.`,
        type: "lead_offer",
        related_id: lead_id,
      });
    }

    // If no agents found, alert admins/dispatchers in-app
    if (offerCount === 0) {
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "dispatcher"]);

      if (admins?.length) {
        await supabase.from("notifications").insert(
          admins.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            title: "No agents available for lead",
            body: `Lead for ${lead.customer_name || "Unknown"} (${lead.service_type || "General"}) — no agents found within ${radius_km}km. Manual assignment needed.`,
            type: "no_agents_available",
            related_id: lead_id,
          }))
        );
      }
    }

    return new Response(JSON.stringify({
      success: true,
      lead_id,
      agents_notified: offerCount,
      whatsapp_sent: notificationsSent,
      radius_km,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[broadcast] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
