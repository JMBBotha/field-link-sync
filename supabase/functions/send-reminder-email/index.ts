import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { renderReminderSignatureHtml, renderSignatureText } from "../_shared/emailSignature.ts";
import { loadSignaturePerson, loadSignatureCompany, replyToFor } from "../_shared/signaturePerson.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    // Invoice follow-up (20 Oct 2026): sends ONE owner-approved reminder by email. pf_claim_send (as the caller) enforces approval + send-once.
    if (body?.followup_id) {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;
      if (!auth.userId) return J({ error: "User login required" }, 401);
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key) return J({ error: "RESEND_API_KEY not set" }, 400);
      const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
      const { data: f, error } = await userSb.rpc("pf_claim_send", { p_id: body.followup_id });
      if (error || !f) return J({ error: error?.message || "Not allowed" }, 400);
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const me = await loadSignaturePerson(sb, auth.userId);
      const co = await loadSignatureCompany(sb, f.company_id);
      const mailbox = Deno.env.get("QUOTES_FROM_EMAIL") || "wcquotes@0800becool.co.za";
      const name = (co as any)?.legalName || (co as any)?.name || "Accounts";
      const text = String(f.message || "");
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#123;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}</div><br>${renderReminderSignatureHtml(me, undefined, co)}`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pf-${f.id}` },
        body: JSON.stringify({
          from: `${String(name).replace(/[<>"]/g, "")} <${mailbox}>`, reply_to: replyToFor(me) || mailbox, to: [f.email],
          subject: f.subject || `Invoice ${f.invoice_number}`, html, text: `${text}\n\n${renderSignatureText(me, co)}`,
          tags: [{ name: "type", value: "payment_followup" }],
        }),
      });
      const rd = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Not delivered: put it back to approved so the owner can retry (still once).
        await sb.from("payment_followups").update({ status: "approved", sent_at: null, sent_by: null, decision_note: `email failed: ${JSON.stringify(rd).slice(0, 200)}` }).eq("id", f.id);
        return J({ error: "Email provider rejected the send", detail: rd }, 502);
      }
      await sb.from("communication_log").insert({ agent_id: auth.userId, type: "email", subject: f.subject, body: text }).then(() => {}, () => {});
      return J({ success: true, sentTo: f.email, id: rd?.id });
    }
    // Legacy drawer (stub, unchanged).
    console.log("Reminder email requested for:", body?.context?.client?.name);
    return J({ success: true, message: "Email request received (stub – Resend/SendGrid integration pending)" });
  } catch (error: any) {
    console.error("Error in send-reminder-email:", error);
    return J({ error: error.message }, 500);
  }
});
