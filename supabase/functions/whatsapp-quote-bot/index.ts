import { serve } from "https://deno.land/std@0.223.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const whatsappToken = Deno.env.get("WHATSAPP_TOKEN")!;
const whatsappPhoneId = Deno.env.get("WHATSAPP_PHONE_ID")!;
const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "becool-whatsapp-verify-2026";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  // Webhook verification (GET from Meta)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === verifyToken) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Verification failed", { status: 403 });
  }

  // Incoming WhatsApp messages (POST)
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message || message.type !== "text") {
        return new Response("No text message", { status: 200 });
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
        await sendWhatsAppMessage(from, reply);
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Error processing message:", err);
      return new Response("Error", { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

async function sendWhatsAppMessage(to: string, text: string) {
  const url = `https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${whatsappToken}`,
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
    const error = await res.text();
    console.error("WhatsApp send error:", error);
  }
}
