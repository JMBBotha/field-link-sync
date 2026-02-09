import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-customer-token, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type, data } = body;

    console.log("[Stripe Webhook] Event type:", type);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    switch (type) {
      case "checkout.session.completed": {
        const session = data.object;
        const userId = session.metadata?.user_id || session.client_reference_id;
        const customerId = session.customer;

        if (!userId) {
          console.error("[Stripe Webhook] No user_id in session metadata");
          break;
        }

        console.log("[Stripe Webhook] Activating subscription for user:", userId);

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "active",
            subscription_plan: "pro",
            stripe_customer_id: customerId,
            jobs_limit: 999999, // Unlimited for pro
          })
          .eq("id", userId);

        if (error) {
          console.error("[Stripe Webhook] Update error:", error);
        } else {
          console.log("[Stripe Webhook] Subscription activated for:", userId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = data.object;
        const customerId = subscription.customer;
        const status = subscription.status;

        console.log("[Stripe Webhook] Subscription updated:", customerId, status);

        // Map Stripe status to our status
        let subStatus = "active";
        if (status === "canceled" || status === "unpaid") subStatus = "canceled";
        if (status === "past_due") subStatus = "expired";

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: subStatus,
            subscription_plan: subStatus === "active" ? "pro" : "free",
            jobs_limit: subStatus === "active" ? 999999 : 50,
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("[Stripe Webhook] Update error:", error);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = data.object;
        const customerId = subscription.customer;

        console.log("[Stripe Webhook] Subscription canceled:", customerId);

        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "canceled",
            subscription_plan: "free",
            jobs_limit: 50,
          })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("[Stripe Webhook] Cancel update error:", error);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = data.object;
        const customerId = invoice.customer;

        console.log("[Stripe Webhook] Payment succeeded for:", customerId);

        // Ensure subscription remains active
        const { error } = await supabase
          .from("profiles")
          .update({ subscription_status: "active" })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("[Stripe Webhook] Payment update error:", error);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = data.object;
        const customerId = invoice.customer;

        console.log("[Stripe Webhook] Payment failed for:", customerId);

        const { error } = await supabase
          .from("profiles")
          .update({ subscription_status: "expired" })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("[Stripe Webhook] Failed payment update error:", error);
        break;
      }

      default:
        console.log("[Stripe Webhook] Unhandled event type:", type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[Stripe Webhook] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
