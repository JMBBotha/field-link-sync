import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * auto-assign-lead
 *
 * Called after a lead is created (by receive-vapi-lead or manually).
 * Finds the best available agent using the dispatch scoring function
 * and assigns them. Then notifies the agent via WhatsApp/SMS.
 *
 * Can be called:
 *   1. Directly via HTTP POST with { lead_id }
 *   2. Via Supabase database webhook on leads INSERT
 *   3. From receive-vapi-lead after creating a lead
 *
 * POST body:
 * {
 *   lead_id: string (required)
 *   force_agent_id?: string  // Skip scoring, assign to this specific agent
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept either service role or webhook secret
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");
    const authHeader = req.headers.get("Authorization");

    // Allow service-to-service calls (from other edge functions) via x-api-key
    // or authenticated user calls via Bearer token
    const isServiceCall = apiKey && expectedKey && apiKey === expectedKey;

    if (!isServiceCall && !authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { lead_id, force_agent_id } = body;

    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the lead details
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, customer_name, customer_phone, customer_address, service_type, priority, status, latitude, longitude, assigned_agent_id, scheduled_date")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found", detail: leadError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already assigned
    if (lead.assigned_agent_id && !force_agent_id) {
      return new Response(JSON.stringify({
        success: true,
        message: "Lead already assigned",
        agent_id: lead.assigned_agent_id,
        skipped: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if lead has no coordinates (address not confirmed yet)
    if ((!lead.latitude || lead.latitude === 0) && !force_agent_id) {
      console.log(`[auto-assign] Lead ${lead_id} has no coordinates — skipping auto-assign`);
      return new Response(JSON.stringify({
        success: true,
        message: "Lead has no coordinates yet — will auto-assign when address is confirmed",
        skipped: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let assignedAgentId: string | null = null;
    let assignedAgentName: string | null = null;
    let assignmentMethod = "manual";
    let distanceKm: number | null = null;
    let score: number | null = null;

    if (force_agent_id) {
      // Direct assignment
      const { data: agent } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", force_agent_id)
        .single();

      assignedAgentId = force_agent_id;
      assignedAgentName = agent?.full_name || "Unknown";
      assignmentMethod = "manual";
    } else {
      // Auto-assign using dispatch scoring
      const urgency = lead.priority === "high" ? "urgent" : "normal";

      const { data: candidates, error: dispatchError } = await supabase
        .rpc("find_best_agent", {
          p_lead_lat: lead.latitude,
          p_lead_lng: lead.longitude,
          p_urgency: urgency,
          p_service_type: lead.service_type,
          p_scheduled_date: lead.scheduled_date || null,
          p_exclude_agent_ids: [],
        });

      if (dispatchError) {
        console.error("[auto-assign] Dispatch scoring error:", dispatchError);
        return new Response(JSON.stringify({
          success: false,
          error: "Dispatch scoring failed",
          detail: dispatchError.message,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!candidates || candidates.length === 0) {
        console.log("[auto-assign] No available agents found");
        return new Response(JSON.stringify({
          success: true,
          message: "No available agents found — lead remains unassigned",
          candidates: 0,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pick the top candidate
      const best = candidates[0];
      assignedAgentId = best.agent_id;
      assignedAgentName = best.agent_name;
      assignmentMethod = best.assignment_method;
      distanceKm = best.distance_km;
      score = best.score;

      console.log(`[auto-assign] Best agent: ${assignedAgentName} (${distanceKm?.toFixed(1)}km, method: ${assignmentMethod})`);
    }

    // Update the lead with the assignment
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        assigned_agent_id: assignedAgentId,
        assignment_method: assignmentMethod,
        assignment_score: score,
        status: "accepted",  // Move from pending to accepted
      })
      .eq("id", lead_id);

    if (updateError) {
      console.error("[auto-assign] Update error:", updateError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to update lead",
        detail: updateError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the assignment in audit_log
    await supabase.from("audit_log").insert({
      table_name: "leads",
      record_id: lead_id,
      action: "auto_assign",
      new_data: {
        agent_id: assignedAgentId,
        agent_name: assignedAgentName,
        method: assignmentMethod,
        distance_km: distanceKm,
        score,
      },
    }).then(({ error }) => {
      if (error) console.warn("[auto-assign] Audit log error:", error);
    });

    // ─── Notify the assigned agent ───
    let notificationSent = false;

    if (assignedAgentId) {
      // Get agent's phone number
      const { data: agentProfile } = await supabase
        .from("profiles")
        .select("phone, full_name")
        .eq("id", assignedAgentId)
        .single();

      if (agentProfile?.phone) {
        const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
        const twilioWhatsApp = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

        if (twilioSid && twilioAuth && twilioWhatsApp) {
          const phoneDigits = agentProfile.phone.replace(/\D/g, "");
          const normalizedPhone = phoneDigits.startsWith("0")
            ? "27" + phoneDigits.slice(1)
            : phoneDigits.startsWith("27") ? phoneDigits : "27" + phoneDigits;

          const msgBody = [
            `🔔 New lead assigned to you!`,
            ``,
            `Customer: ${lead.customer_name}`,
            `Service: ${lead.service_type || "General"}`,
            `Priority: ${lead.priority || "medium"}`,
            lead.customer_address ? `Address: ${lead.customer_address}` : "",
            distanceKm ? `Distance: ${distanceKm.toFixed(1)}km from you` : "",
            ``,
            `Open FieldLink Sync to accept or reassign.`,
          ].filter(Boolean).join("\n");

          try {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const response = await fetch(twilioUrl, {
              method: "POST",
              headers: {
                "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                From: `whatsapp:${twilioWhatsApp}`,
                To: `whatsapp:+${normalizedPhone}`,
                Body: msgBody,
              }),
            });

            if (response.ok) {
              notificationSent = true;
              console.log(`[auto-assign] Agent notified via WhatsApp: +${normalizedPhone}`);
            } else {
              const err = await response.json();
              console.warn(`[auto-assign] WhatsApp notification failed:`, err.message);
            }
          } catch (notifErr: any) {
            console.warn(`[auto-assign] Notification error:`, notifErr.message);
          }
        }
      }

      // Also create an in-app notification
      await supabase.from("notifications").insert({
        user_id: assignedAgentId,
        title: "New Lead Assigned",
        message: `${lead.customer_name} — ${lead.service_type || "General inquiry"}. ${distanceKm ? distanceKm.toFixed(1) + "km away." : ""}`,
        type: "lead_assignment",
        data: { lead_id, distance_km: distanceKm },
      }).then(({ error }) => {
        if (error) console.warn("[auto-assign] Notification insert error:", error);
      });
    }

    return new Response(JSON.stringify({
      success: true,
      lead_id,
      agent_id: assignedAgentId,
      agent_name: assignedAgentName,
      assignment_method: assignmentMethod,
      distance_km: distanceKm,
      score,
      notification_sent: notificationSent,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[auto-assign] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
