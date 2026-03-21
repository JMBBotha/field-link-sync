import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * handle-whatsapp-address-reply
 * 
 * Called when a customer replies to the WhatsApp address confirmation.
 * Geocodes their address using Mapbox, updates the lead with coordinates,
 * then triggers auto-assign to find the nearest agent.
 * 
 * This is called from the whatsapp-quote-bot or Twilio webhook
 * when an incoming message matches a pending lead.
 * 
 * POST body:
 * {
 *   customer_phone: string,  // The phone number that replied
 *   message_body: string,    // The address text they sent
 *   lead_id?: string         // Optional — if known from context
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Normalize SA phone
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

// Geocode an address using Mapbox
async function geocodeAddress(address: string): Promise<{
  lat: number;
  lng: number;
  formatted_address: string;
  confidence: string;
} | null> {
  const mapboxToken = Deno.env.get("MAPBOX_ACCESS_TOKEN");
  if (!mapboxToken) {
    console.error("[geocode] MAPBOX_ACCESS_TOKEN not set");
    return null;
  }

  // Add "South Africa" to improve geocoding accuracy for SA addresses
  const query = address.includes("South Africa") || address.includes("SA") 
    ? address 
    : `${address}, South Africa`;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&country=ZA&limit=1&types=address,place,locality,neighborhood`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const [lng, lat] = feature.center;
      
      return {
        lat,
        lng,
        formatted_address: feature.place_name || address,
        confidence: feature.relevance >= 0.8 ? "high" : feature.relevance >= 0.5 ? "medium" : "low",
      };
    }

    console.warn(`[geocode] No results for: ${query}`);
    return null;
  } catch (err: any) {
    console.error(`[geocode] Error:`, err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");

    if (!expectedKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { customer_phone, message_body, lead_id: providedLeadId } = body;

    if (!customer_phone || !message_body) {
      return new Response(JSON.stringify({ error: "customer_phone and message_body required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(customer_phone);
    console.log(`[address-reply] From: ${normalizedPhone}, Message: ${message_body}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the most recent pending lead for this phone number
    let leadId = providedLeadId;

    if (!leadId) {
      const { data: recentLead } = await supabase
        .from("leads")
        .select("id")
        .eq("customer_phone", normalizedPhone)
        .in("status", ["pending", "new"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (recentLead) {
        leadId = recentLead.id;
      }
    }

    if (!leadId) {
      console.warn(`[address-reply] No pending lead found for ${normalizedPhone}`);
      return new Response(JSON.stringify({
        success: false,
        message: "No pending lead found for this number",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Geocode the address
    const geocoded = await geocodeAddress(message_body);

    if (!geocoded) {
      console.warn(`[address-reply] Could not geocode: ${message_body}`);

      // Still update the lead with the raw address text
      await supabase
        .from("leads")
        .update({
          customer_address: message_body,
          notes: `Address provided via WhatsApp but could not be geocoded: "${message_body}"`,
        })
        .eq("id", leadId);

      // Send a follow-up asking for a more specific address
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioWhatsApp = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

      if (twilioSid && twilioAuth && twilioWhatsApp) {
        const phoneDigits = normalizedPhone.replace(/\D/g, "");
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: `whatsapp:${twilioWhatsApp}`,
              To: `whatsapp:${normalizedPhone}`,
              Body: `Thanks! I couldn't quite pinpoint that address. Could you include your street number and suburb? For example: "12 Oak Street, Durbanville" 📍`,
            }),
          }
        );
      }

      return new Response(JSON.stringify({
        success: true,
        lead_id: leadId,
        geocoded: false,
        message: "Address saved but not geocoded — follow-up sent",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update lead with geocoded address
    console.log(`[address-reply] Geocoded: ${geocoded.formatted_address} (${geocoded.lat}, ${geocoded.lng}) [${geocoded.confidence}]`);

    await supabase
      .from("leads")
      .update({
        customer_address: geocoded.formatted_address,
        latitude: geocoded.lat,
        longitude: geocoded.lng,
      })
      .eq("id", leadId);

    // Also update the customer record
    const { data: lead } = await supabase
      .from("leads")
      .select("customer_id")
      .eq("id", leadId)
      .single();

    if (lead?.customer_id) {
      await supabase
        .from("customers")
        .update({
          address: geocoded.formatted_address,
          latitude: geocoded.lat,
          longitude: geocoded.lng,
        })
        .eq("id", lead.customer_id);
    }

    // Now trigger auto-assign since we have coordinates
    let autoAssignResult: any = null;
    try {
      const assignResponse = await fetch(
        `${supabaseUrl}/functions/v1/auto-assign-lead`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": expectedKey,
          },
          body: JSON.stringify({ lead_id: leadId }),
        }
      );
      autoAssignResult = await assignResponse.json();
      console.log(`[address-reply] Auto-assign result:`, JSON.stringify(autoAssignResult));
    } catch (assignErr: any) {
      console.warn(`[address-reply] Auto-assign error:`, assignErr.message);
    }

    // Send confirmation to customer
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioWhatsApp = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

    if (twilioSid && twilioAuth && twilioWhatsApp) {
      const phoneDigits = normalizedPhone.replace(/\D/g, "");
      const agentName = autoAssignResult?.agent_name;
      
      const confirmMsg = agentName
        ? `Thanks! We've confirmed your address as ${geocoded.formatted_address}. ${agentName} has been assigned and will be in touch shortly. 👍`
        : `Thanks! We've confirmed your address as ${geocoded.formatted_address}. A technician will be assigned shortly. 👍`;

      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: `whatsapp:${twilioWhatsApp}`,
            To: `whatsapp:${normalizedPhone}`,
            Body: confirmMsg,
          }),
        }
      );
    }

    return new Response(JSON.stringify({
      success: true,
      lead_id: leadId,
      geocoded: true,
      address: geocoded.formatted_address,
      coordinates: { lat: geocoded.lat, lng: geocoded.lng },
      confidence: geocoded.confidence,
      auto_assign: autoAssignResult,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[address-reply] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
