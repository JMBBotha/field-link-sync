import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { admin, corsHeaders, json } from "../_shared/dispatch.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { offer_id, staff_id } = await req.json();
    if (!offer_id) return json({ error: "offer_id is required" }, 400);

    // Identify caller from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return json({ error: "Not authenticated" }, 401);
    if (staff_id && staff_id !== callerId) {
      return json({ error: "Cannot accept an offer on behalf of another user" }, 403);
    }

    const db = admin();

    // Atomic claim (row lock + unique partial index)
    const { data: claim, error: claimErr } = await db.rpc("claim_offer", {
      p_offer_id: offer_id,
      p_staff_id: callerId,
    });
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claim?.ok) return json({ error: claim?.message ?? "Could not claim offer" }, claim?.code ?? 409);

    const leadId = claim.lead_id as string;
    const offerType = claim.offer_type as "sales_estimate" | "service_call";

    const { data: lead } = await db
      .from("leads")
      .select("id, company_id, customer_id, customer_name, customer_address, service_type, latitude, longitude, priority, scheduled_date, scheduled_time, notes")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return json({ error: "Lead not found" }, 404);

    // Job record (reuse existing job if the lead already has one)
    const { data: existingJob } = await db
      .from("jobs")
      .select("id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const scheduledAt = lead.scheduled_date
      ? new Date(`${lead.scheduled_date}T${lead.scheduled_time ?? "09:00"}`).toISOString()
      : null;

    const jobPayload: Record<string, unknown> = {
      title: `${lead.service_type ?? "Job"} — ${lead.customer_name ?? "Customer"}`,
      description: lead.notes ?? null,
      address: lead.customer_address ?? null,
      lat: lead.latitude ?? null,
      lng: lead.longitude ?? null,
      priority: lead.priority ?? "normal",
      status: scheduledAt ? "scheduled" : "assigned",
      scheduled_for: scheduledAt,
      job_type: offerType === "sales_estimate" ? "quote" : "service",
      company_id: lead.company_id,
      customer_id: lead.customer_id,
      lead_id: leadId,
    };

    let jobId = existingJob?.id as string | undefined;
    if (jobId) {
      await db.from("jobs").update(jobPayload).eq("id", jobId);
    } else {
      const { data: inserted, error: jobErr } = await db
        .from("jobs")
        .insert(jobPayload)
        .select("id")
        .single();
      if (jobErr) return json({ error: `Job creation failed: ${jobErr.message}` }, 500);
      jobId = inserted.id;
    }

    // Assignment record so existing job surfaces pick it up
    const { data: existingAssign } = await db
      .from("assignments")
      .select("id")
      .eq("job_id", jobId)
      .eq("profile_id", callerId)
      .maybeSingle();
    if (existingAssign) {
      await db.from("assignments").update({ status: "accepted" }).eq("id", existingAssign.id);
    } else {
      await db.from("assignments").insert({
        job_id: jobId,
        profile_id: callerId,
        assigned_by: callerId,
        status: "accepted",
        assignment_type: "offer",
      });
    }

    // Draft estimate for sales offers
    let quoteId: string | null = null;
    if (offerType === "sales_estimate" && lead.customer_id) {
      const { data: existingQuote } = await db
        .from("quotes")
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingQuote) {
        quoteId = existingQuote.id;
      } else {
        const { data: quote, error: qErr } = await db
          .from("quotes")
          .insert({
            lead_id: leadId,
            customer_id: lead.customer_id,
            company_id: lead.company_id,
            sales_engineer_id: callerId,
            status: "draft",
            subtotal: 0,
            vat_rate: 15,
            vat_amount: 0,
            total: 0,
          })
          .select("id")
          .single();
        if (qErr) console.error("[accept-offer] quote create failed:", qErr);
        else quoteId = quote.id;
      }
      if (quoteId) await db.from("jobs").update({ quote_id: quoteId }).eq("id", jobId);
    }

    await db
      .from("leads")
      .update({
        assigned_agent_id: callerId,
        status: "assigned",
        lead_status: "in_progress",
        needs_manual_assignment: false,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    await db.from("job_activity_log").insert({
      job_id: jobId,
      user_id: callerId,
      action: "offer_accepted",
      details: { offer_id, lead_id: leadId, offer_type: offerType },
    });

    return json({ success: true, job_id: jobId, quote_id: quoteId, lead_id: leadId });
  } catch (err) {
    console.error("[accept-offer]", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});
