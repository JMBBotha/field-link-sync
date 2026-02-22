import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COMPANY_ID = "b8566007-f29c-46a5-97c9-cca365e638c7";

interface QuoteState {
  step: number;
  area?: string;
  unit?: string;
  qty: number;
  price: number;
  total: number;
}

const stateStore: Record<string, QuoteState> = {};

console.log("WhatsApp Quote Bot initialized");

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const whatsappToken = Deno.env.get("WHATSAPP_TOKEN") ?? "";
  const whatsappPhoneId = Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "becool-whatsapp-verify-2026";

  // Webhook verification (GET from Meta)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    console.log("Verification request:", { mode, token, challenge });

    if (mode === "subscribe" && token === verifyToken) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Verification failed", { status: 403, headers: corsHeaders });
  }

  // Incoming WhatsApp messages (POST)
  if (req.method === "POST") {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
      const body = await req.json();
      console.log("Incoming webhook:", JSON.stringify(body));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message || message.type !== "text") {
        return new Response("No text message", { status: 200, headers: corsHeaders });
      }

      const from = message.from;
      const text = message.text.body.trim().toLowerCase();

      if (!stateStore[from]) {
        stateStore[from] = { step: 0, qty: 1, price: 0, total: 0 };
      }
      const state = stateStore[from];

      let reply = "";

      switch (state.step) {
        case 0:
          if (text.includes("start") || text === "hi" || text === "hello") {
            state.step = 1;
            reply = "Welcome to 0800BeCool Quote Builder! 🚀\n\nStep 1: Reply with the area name (e.g. Bedroom, Lounge, Office)";
          } else {
            reply = "Reply 'start' to begin creating a quote!";
          }
          break;

        case 1:
          state.area = text.charAt(0).toUpperCase() + text.slice(1);
          state.step = 2;
          reply = `Area set to *${state.area}*.\n\nStep 2: Reply with the AC unit (e.g. Daikin 7kW, Samsung 12k BTU)`;
          break;

        case 2: {
          const { data: product } = await supabase
            .from("supplier_products")
            .select("id, name, selling_price")
            .ilike("name", `%${text}%`)
            .limit(1)
            .single();

          if (product) {
            state.unit = product.name;
            state.price = product.selling_price || 4500;
            state.total = state.price * state.qty;
            state.step = 3;
            reply = `Unit selected: *${state.unit}* @ R${state.price.toFixed(2)}\n\nStep 3: How many units? (reply with number, default 1)`;
          } else {
            reply = "Sorry, couldn't find that unit. Try again (e.g. Daikin 7kW)";
          }
          break;
        }

        case 3: {
          const qty = parseInt(text) || 1;
          state.qty = qty;
          state.total = state.price * qty;
          state.step = 4;
          reply = `Got it — ${qty} × ${state.unit} = R${state.total.toFixed(2)}\n\nReply *done* to save this quote, or *cancel* to start over.`;
          break;
        }

        case 4:
          if (text === "done") {
            const { error } = await supabase.from("proposals").insert({
              company_id: COMPANY_ID,
              status: "Draft",
              total_amount: state.total,
              total: state.total,
              areas: [{ name: state.area, unit: state.unit, quantity: state.qty, unit_price: state.price }],
              source: "whatsapp",
            });

            if (error) {
              console.error("Insert error:", error);
              reply = "Error saving quote. Please try again or contact support.";
            } else {
              reply = `Quote saved successfully! ✅ Total: R${state.total.toFixed(2)}\n\nCheck it in the admin portal.\n\nReply *start* for a new quote.`;
              delete stateStore[from];
            }
          } else if (text === "cancel") {
            delete stateStore[from];
            reply = "Quote cancelled. Reply *start* to begin again.";
          } else {
            reply = "Reply *done* to save or *cancel* to discard.";
          }
          break;
      }

      if (reply) {
        await sendWhatsAppMessage(whatsappPhoneId, whatsappToken, from, reply);
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    } catch (err) {
      console.error("Error processing message:", err);
      return new Response("Error", { status: 500, headers: corsHeaders });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});

async function sendWhatsAppMessage(phoneId: string, token: string, to: string, text: string) {
  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("WhatsApp send error:", errorText);

    // Parse error for specific handling
    try {
      const errorJson = JSON.parse(errorText);
      const errorCode = errorJson?.error?.code;

      if (errorCode === 133010) {
        console.error(
          "ERROR #133010: Phone number not registered. " +
          "This means the WhatsApp Business Account or phone number has not completed Meta's registration/verification process. " +
          "Steps to fix: 1) Register a real phone number (not test number) 2) Complete Business Verification in Meta Business Manager 3) Wait for approval (1-5 days)"
        );
      }
    } catch {
      // Not JSON, already logged raw error
    }
  }
}
