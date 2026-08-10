// Approve / reject a customer change request (reschedule or cancellation).
// Approving applies the new time to the lead AND the linked job, then WhatsApps
// the customer a confirmation. Rejecting keeps the original booking and tells
// the customer their requested slot isn't available.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authCorsHeaders, requireUser } from "../_shared/auth.ts";
import { sendWhatsApp, toE164 } from "../_shared/whatsapp.ts";
import { formatWhen, tidyAddress } from "../_shared/appointmentConfirmation.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...authCorsHeaders, "Content-Type": "application/json" },
  });

/** "2026-08-13 14:00" | "2026-08-13" | "14:00" -> { date, time } */
function parseRequestedValue(
  value: string,
  fallbackDate?: string | null,
): { date: string | null; time: string | null } {
  const v = String(value || "").trim();
  const date = v.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? fallbackDate ?? null;
  const time = v.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? null;
  return { date, time: time ? time.padStart(5, "0") : null };
}

function isoFor(date: string, time: string): string {
  return new Date(`${date}T${time}:00+02:00`).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: authCorsHeaders });

  const auth = await requireUser(req, ["admin", "dispatcher"]);
  if (!auth.ok) return auth.response;

  try {
    const { requestId, action, reviewNotes, alternativeMessage } = await req.json();
    if (!requestId || !["approve", "reject"].includes(action)) {
      return json({ error: "requestId and action (approve|reject) are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: request, error: reqErr } = await supabase
      .from("lead_change_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (reqErr) throw reqErr;
    if (!request) return json({ error: "Change request not found" }, 404);
    if (request.status !== "pending") {
      return json({ error: `Request already ${request.status}` }, 409);
    }

    const kind = request.request_type === "cancellation" ? "cancellation" : "reschedule";

    const { data: lead } = request.lead_id
      ? await supabase.from("leads").select("*").eq("id", request.lead_id).maybeSingle()
      : { data: null as any };

    // ---- Apply the change -------------------------------------------------
    let appliedIso: string | null = null;
    let applied = { lead: false, jobs: 0 };

    if (action === "approve") {
      if (kind === "reschedule") {
        const { date, time } = parseRequestedValue(
          request.requested_value,
          lead?.scheduled_date ?? null,
        );
        if (!date || !time) {
          return json(
            {
              error:
                "This request has no specific date/time to apply. Edit the booking manually, then reject or close this request.",
            },
            422,
          );
        }
        appliedIso = isoFor(date, time);

        if (lead?.id) {
          const { error } = await supabase
            .from("leads")
            .update({ scheduled_date: date, scheduled_time: `${time}:00` })
            .eq("id", lead.id);
          if (error) throw error;
          applied.lead = true;

          const { data: jobs } = await supabase
            .from("jobs")
            .select("id")
            .eq("lead_id", lead.id)
            .not("status", "in", "(completed,cancelled)");
          for (const job of jobs ?? []) {
            const { error: jErr } = await supabase
              .from("jobs")
              .update({ scheduled_for: appliedIso, status: "scheduled" })
              .eq("id", job.id);
            if (!jErr) applied.jobs += 1;
          }
          if (!applied.jobs && lead.customer_id) {
            const { data: custJobs } = await supabase
              .from("jobs")
              .select("id")
              .eq("customer_id", lead.customer_id)
              .not("status", "in", "(completed,cancelled)")
              .order("created_at", { ascending: false })
              .limit(1);
            for (const job of custJobs ?? []) {
              const { error: jErr } = await supabase
                .from("jobs")
                .update({ scheduled_for: appliedIso, lead_id: lead.id, status: "scheduled" })
                .eq("id", job.id);
              if (!jErr) applied.jobs += 1;
            }
          }
        }
      } else {
        if (lead?.id) {
          const { error } = await supabase
            .from("leads")
            .update({ status: "cancelled" })
            .eq("id", lead.id);
          if (error) throw error;
          applied.lead = true;

          const { data: jobs } = await supabase
            .from("jobs")
            .select("id")
            .eq("lead_id", lead.id)
            .not("status", "in", "(completed,cancelled)");
          for (const job of jobs ?? []) {
            const { error: jErr } = await supabase
              .from("jobs")
              .update({ status: "cancelled" })
              .eq("id", job.id);
            if (!jErr) applied.jobs += 1;
          }
        }
      }
    }

    // ---- Mark the request -------------------------------------------------
    const { error: statusErr } = await supabase
      .from("lead_change_requests")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth.userId,
        review_notes: reviewNotes || null,
      })
      .eq("id", requestId);
    if (statusErr) throw statusErr;

    // ---- Tell the customer -----------------------------------------------
    let whatsapp: Record<string, unknown> = { sent: false, reason: "no phone" };

    let phone: string | null = lead?.customer_phone || lead?.phone || null;
    let firstName = String(lead?.customer_name || "").trim().split(/\s+/)[0] || "there";
    let address = "";
    if (lead?.customer_id) {
      const { data: customer } = await supabase
        .from("customers")
        .select("first_name, last_name, phone, primary_address_line1")
        .eq("id", lead.customer_id)
        .maybeSingle();
      if (customer) {
        phone = phone || customer.phone || null;
        if (customer.first_name) firstName = customer.first_name;
        address = tidyAddress(customer.primary_address_line1);
      }
    }

    if (phone && request.source === "customer_whatsapp") {
      let body: string;
      if (action === "approve" && kind === "reschedule" && appliedIso) {
        const when = formatWhen(appliedIso);
        const lines = [
          `Hi ${firstName}! 👋`,
          "",
          "Good news — your 0800-BE-COOL appointment has been *moved*. New details:",
          "",
          `🛠 ${lead?.service_type || "Service call"}`,
          `📅 ${when.day}`,
          `⏰ ${when.time}`,
        ];
        if (address) lines.push(`📍 ${address}`);
        lines.push("", "Our technician will call you before arriving.", "", "Need to change anything else? Just reply here.");
        body = lines.join("\n");
      } else if (action === "approve") {
        body = [
          `Hi ${firstName},`,
          "",
          "Your 0800-BE-COOL appointment has been *cancelled* as requested. Nothing further will be charged.",
          "",
          "Whenever you'd like to book again, just reply here or call 0800-BE-COOL.",
        ].join("\n");
      } else if (kind === "reschedule") {
        body = [
          `Hi ${firstName},`,
          "",
          "Thanks for your patience — unfortunately the time you asked for isn't available. *Your original appointment stays as booked.*",
          alternativeMessage ? `\n${alternativeMessage}` : "",
          "",
          "Reply here with another time that suits you, or call 0800-BE-COOL and we'll find a slot together.",
        ].filter(Boolean).join("\n");
      } else {
        body = [
          `Hi ${firstName},`,
          "",
          "We couldn't cancel your appointment automatically — *your original booking stays in place* for now.",
          "",
          "Please reply here or call 0800-BE-COOL so our team can help you directly.",
        ].join("\n");
      }

      const result = await sendWhatsApp({ to: toE164(phone), body });
      whatsapp = { sent: result.ok, sid: result.sid, error: result.error };

      await supabase.from("whatsapp_messages").insert({
        direction: "outbound",
        environment: twilioEnvironment(),
        from_number: "system",
        to_number: toE164(phone),
        body,
        provider_sid: result.sid ?? null,
        status: result.ok ? (result.status ?? "queued") : "failed",
        error_message: result.ok ? null : (result.error ?? null),
        lead_id: lead?.id ?? null,
        customer_id: lead?.customer_id ?? null,
        raw: { kind: `change_request_${action}`, change_request_id: requestId },
      });


      if (request.source === "customer_whatsapp") {
        await supabase
          .from("whatsapp_conversation_state")
          .delete()
          .eq("phone", toE164(phone))
          .eq("state", "awaiting_reschedule_approval");
      }
    }

    return json({ ok: true, action, kind, applied, appliedIso, whatsapp });
  } catch (e) {
    console.error("[resolve-change-request]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
