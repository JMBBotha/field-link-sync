// Consumes public.entity_outbox — the server-side side-effect pipeline for entity edits.
// Runs regardless of which popup made the change and survives the popup closing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendWhatsApp, isWhatsAppConfigured, toE164 } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

interface OutboxEvent {
  id: string;
  company_id: string | null;
  entity_type: string;
  entity_id: string;
  event_type: string;
  payload: Record<string, any>;
  attempts: number;
}

const fmtDate = (d?: string | null) => {
  if (!d) return "";
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return d;
  }
};

async function notifyCustomer(ev: OutboxEvent) {
  const next = ev.payload?.new ?? {};
  const changed: string[] = ev.payload?.changed ?? [];
  const phone = next.customer_phone;

  const scheduleChanged = changed.some((c) =>
    ["scheduled_date", "scheduled_time", "assigned_agent_id"].includes(c),
  );
  const statusChanged = changed.includes("status");

  let body = "";
  if (scheduleChanged && next.scheduled_date) {
    body = `Hi ${next.customer_name || "there"}, your ${next.service_type || "service"} appointment is now booked for ${fmtDate(next.scheduled_date)}${next.scheduled_time ? ` at ${String(next.scheduled_time).slice(0, 5)}` : ""}. Reply here if that doesn't suit you.`;
  } else if (statusChanged && next.status === "completed") {
    body = `Hi ${next.customer_name || "there"}, your ${next.service_type || "service"} job is now marked complete. Thank you for your business!`;
  } else if (statusChanged && next.status === "cancelled") {
    body = `Hi ${next.customer_name || "there"}, your ${next.service_type || "service"} booking has been cancelled. Reply here if you'd like to rebook.`;
  }

  if (!body) return { skipped: "no message applicable" };
  if (!phone) return { skipped: "no customer phone" };
  if (!isWhatsAppConfigured()) return { skipped: "whatsapp not configured" };

  const result = await sendWhatsApp({ to: toE164(phone), body });

  await admin.from("communication_log").insert({
    lead_id: ev.entity_type === "lead" ? ev.entity_id : null,
    type: "whatsapp",
    subject: "Job update",
    body,
  });

  return result;
}

async function recalcInvoice(ev: OutboxEvent) {
  if (ev.entity_type !== "lead") return { skipped: "no linked invoice source" };

  const { data: invoices, error } = await admin
    .from("invoices")
    .select("id, status, tax_rate, line_items")
    .eq("lead_id", ev.entity_id);
  if (error) throw error;
  if (!invoices?.length) return { skipped: "no linked invoice" };

  const results: any[] = [];
  for (const inv of invoices) {
    const { data: items } = await admin
      .from("invoice_items")
      .select("quantity, unit_price, amount")
      .eq("invoice_id", inv.id);

    const rows = items?.length
      ? items
      : Array.isArray(inv.line_items)
        ? (inv.line_items as any[])
        : [];

    const subtotal =
      Math.round(
        rows.reduce(
          (sum: number, it: any) =>
            sum +
            Number(it.amount ?? Number(it.quantity ?? 0) * Number(it.unit_price ?? 0)),
          0,
        ) * 100,
      ) / 100;

    const rate = Number(inv.tax_rate ?? 15);
    const tax = Math.round(subtotal * (rate / 100) * 100) / 100;
    const grand = Math.round((subtotal + tax) * 100) / 100;

    const patch: Record<string, any> = {
      subtotal,
      tax_amount: tax,
      grand_total: grand,
      updated_at: new Date().toISOString(),
    };
    if (ev.payload?.status === "cancelled" && inv.status === "draft") {
      patch.status = "cancelled";
    }

    const { error: upErr } = await admin.from("invoices").update(patch).eq("id", inv.id);
    if (upErr) throw upErr;
    results.push({ invoice_id: inv.id, grand_total: grand });
  }
  return { recalculated: results };
}

async function handle(ev: OutboxEvent) {
  switch (ev.event_type) {
    case "notify_customer":
      return await notifyCustomer(ev);
    case "recalc_invoice":
      return await recalcInvoice(ev);
    case "entity_updated":
      // Audit is written transactionally by update_entity; nothing async needed.
      return { ok: true };
    default:
      return { skipped: `unknown event ${ev.event_type}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { data: events, error } = await admin
      .from("entity_outbox")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;

    const processed: any[] = [];
    for (const ev of (events ?? []) as OutboxEvent[]) {
      // Claim first so a concurrent run can't double-send.
      const { data: claimed } = await admin
        .from("entity_outbox")
        .update({ status: "processing", attempts: ev.attempts + 1 })
        .eq("id", ev.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        const result = await handle(ev);
        await admin
          .from("entity_outbox")
          .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
          .eq("id", ev.id);
        processed.push({ id: ev.id, event: ev.event_type, result });
      } catch (err: any) {
        const failed = ev.attempts + 1 >= MAX_ATTEMPTS;
        await admin
          .from("entity_outbox")
          .update({
            status: failed ? "failed" : "pending",
            last_error: String(err?.message ?? err).slice(0, 500),
          })
          .eq("id", ev.id);
        processed.push({ id: ev.id, event: ev.event_type, error: String(err?.message ?? err) });
      }
    }

    return new Response(JSON.stringify({ processed: processed.length, details: processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("process-outbox error", err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
