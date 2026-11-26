/**
 * Emails a stored job / warranty card. Does nothing unless the company
 * switch auto_send_job_card is on (it defaults off). Sends through
 * send-transactional-email from johan@0800becool.co.za.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authCorsHeaders, requireUser } from "../_shared/auth.ts";
import { companyIsActive } from "../_shared/companyActive.ts";
import { buildJobCardEmail } from "../_shared/jobCardEmail.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...authCorsHeaders, "Content-Type": "application/json" } });

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: authCorsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  if (!auth.userId) return json(401, { sent: false, error: "Not authenticated" });

  try {
    const body = await req.json().catch(() => ({}));
    const jobCardId = String(body?.job_card_id || "").trim();
    if (!jobCardId) return json(400, { sent: false, error: "job_card_id is required" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: profile } = await admin.from("profiles").select("company_id").eq("id", auth.userId).maybeSingle();
    const { data: card } = await admin
      .from("job_cards")
      .select("id, company_id, job_id, customer_id, client_name, signed, completed_at, storage_path")
      .eq("id", jobCardId)
      .maybeSingle();
    if (!card?.company_id || !profile?.company_id || profile.company_id !== card.company_id) {
      return json(403, { sent: false, error: "Not allowed" });
    }

    // Missing column, a read error, or anything other than true stays off. No email is sent.
    const flags = await admin.from("companies").select("auto_send_job_card").eq("id", card.company_id).maybeSingle();
    const autoSend = !flags.error && flags.data?.auto_send_job_card === true;
    if (!autoSend) return json(200, { sent: false, reason: "auto_send_off" });
    if (!(await companyIsActive(admin, card.company_id))) return json(200, { sent: false, reason: "company_archived" });

    let to: string | null = null;
    if (card.customer_id) {
      const { data: customer } = await admin.from("customers").select("email, company_id").eq("id", card.customer_id).maybeSingle();
      if (customer?.company_id === card.company_id) to = customer.email ?? null;
    }
    const { data: job } = await admin.from("jobs").select("title, company_id").eq("id", card.job_id).maybeSingle();
    if (!job || job.company_id !== card.company_id) return json(403, { sent: false, error: "Not allowed" });

    const file = await admin.storage.from("job-cards").download(card.storage_path);
    const pdfBase64 = file.data ? bytesToBase64(new Uint8Array(await file.data.arrayBuffer())) : null;
    const completedLabel = card.completed_at
      ? new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(card.completed_at))
      : "";
    const decision = buildJobCardEmail({
      autoSend: true,
      to,
      clientName: card.client_name,
      jobTitle: job.title,
      completedLabel,
      signed: card.signed === true,
      pdfBase64,
    });
    if (!decision.send) return json(200, { sent: false, reason: decision.reason });

    const { data: cfg } = await admin.from("app_webhook_config").select("email_webhook_token").eq("id", 1).single();
    if (!cfg?.email_webhook_token) return json(200, { sent: false, reason: "email_not_configured" });

    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-email-webhook-token": String(cfg.email_webhook_token) },
      body: JSON.stringify({
        to: decision.to,
        subject: decision.subject,
        html: decision.html,
        from_email: decision.fromEmail,
        from_name: decision.fromName,
        company_id: card.company_id,
        file_attachments: [{ filename: decision.filename, content: decision.pdfBase64 }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("job card email failed", response.status, detail.slice(0, 300));
      return json(200, { sent: false, reason: "email_failed" });
    }
    await admin.from("job_cards").update({ emailed_at: new Date().toISOString() }).eq("id", card.id);
    return json(200, { sent: true, reason: "sent" });
  } catch (err) {
    console.error("send-job-card error", String((err as { message?: string })?.message || err).slice(0, 200));
    return json(500, { sent: false, reason: "error" });
  }
});
