import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { admin, corsHeaders, escalate, json, loadCandidates, requireDispatcher, DEFAULT_RADIUS_KM } from "../_shared/dispatch.ts";

/**
 * dispatch-service-job — direct-assigns the nearest available technician
 * (geo + skill + priority). Creates a draft job and a draft invoice shell.
 * Falls back to the unassigned queue + escalation when no tech is available.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await requireDispatcher(req);
    if (!auth.ok) return auth.response;

    const { lead_id, radius_km, skill } = await req.json();
    if (!lead_id) return json({ error: "lead_id is required" }, 400);

    const db = admin();
    const { data: lead } = await db
      .from("leads")
      .select("id, company_id, customer_id, customer_name, customer_phone, customer_address, service_type, latitude, longitude, priority, primary_intent, notes")
      .eq("id", lead_id)
      .maybeSingle();
    if (!lead) return json({ error: "Lead not found" }, 404);

    if (lead.primary_intent && lead.primary_intent !== "service") {
      return json({ error: "Lead is not classified as a service request" }, 400);
    }

    // Emergency jobs search a wider net.
    const radius = Number(radius_km) ||
      (lead.priority === "emergency" ? DEFAULT_RADIUS_KM * 2 : DEFAULT_RADIUS_KM);

    const candidates = await loadCandidates(db, lead_id, "technician", radius, skill ?? null);
    const tech = candidates[0] ?? null;

    // Draft job (assigned or queued)
    const { data: existingJob } = await db
      .from("jobs")
      .select("id")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const jobPayload: Record<string, unknown> = {
      title: `${lead.service_type ?? "Service call"} — ${lead.customer_name ?? "Customer"}`,
      description: lead.notes ?? null,
      address: lead.customer_address ?? null,
      lat: lead.latitude ?? null,
      lng: lead.longitude ?? null,
      priority: lead.priority ?? "normal",
      status: tech ? "assigned" : "unassigned",
      job_type: "service",
      company_id: lead.company_id,
      customer_id: lead.customer_id,
      lead_id,
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

    // Draft invoice shell tied to the lead
    const { data: existingInvoice } = await db
      .from("invoices")
      .select("id")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let invoiceId = existingInvoice?.id as string | undefined;
    if (!invoiceId) {
      const { data: numberRes } = await db.rpc("generate_invoice_number");
      const { data: invoice, error: invErr } = await db
        .from("invoices")
        .insert({
          lead_id,
          customer_id: lead.customer_id,
          company_id: lead.company_id,
          agent_id: tech?.staff_id ?? null,
          invoice_number: numberRes,
          customer_name: lead.customer_name ?? "",
          customer_phone: lead.customer_phone ?? "",
          customer_address: lead.customer_address ?? null,
          status: "draft",
          subtotal: 0,
          tax_rate: 15,
          tax_amount: 0,
          grand_total: 0,
          line_items: [],
        })
        .select("id")
        .single();
      if (invErr) console.error("[dispatch-service-job] invoice shell failed:", invErr);
      else invoiceId = invoice.id;
    }
    if (invoiceId && jobId) await db.from("jobs").update({ invoice_id: invoiceId }).eq("id", jobId);

    if (!tech) {
      await escalate(db, lead, "No available technician within radius — job queued as unassigned");
      return json({
        success: false,
        queued: true,
        job_id: jobId,
        invoice_id: invoiceId,
        message: "No technician available; job queued and admin notified",
      });
    }

    await db.from("assignments").insert({
      job_id: jobId,
      profile_id: tech.staff_id,
      assigned_by: null,
      status: "proposed",
      assignment_type: "auto_geo",
      notes: `Auto-assigned: nearest technician (${tech.distance_km} km)`,
    });

    await db
      .from("leads")
      .update({
        assigned_agent_id: tech.staff_id,
        lead_status: "routed",
        needs_manual_assignment: false,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", lead_id);

    await db.from("notifications").insert({
      user_id: tech.staff_id,
      type: "offer_service",
      title: "New service job assigned",
      body: `${lead.customer_name ?? "Customer"} — ${lead.service_type ?? "service call"} (${tech.distance_km} km away).`,
      related_id: jobId,
      metadata: { job_id: jobId, lead_id, distance_km: tech.distance_km },
    });

    return json({
      success: true,
      job_id: jobId,
      invoice_id: invoiceId,
      technician_id: tech.staff_id,
      distance_km: tech.distance_km,
    });
  } catch (err) {
    console.error("[dispatch-service-job]", err);
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
});
