// Call report: Grok summary of a phone call + email to the admin.
// Reads public.vapi_calls only; never writes to it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GROK_MODEL = "grok-4.3";
const APP_URL = "https://field-link-sync.lovable.app";
const SERVICE_TYPES = ["New Quote", "Technical Service Call", "New Installation", "General Inquiry", "Other"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    breakdown: { type: "string" },
    lead_level: { type: "string", enum: ["hot", "warm", "cold"] },
    urgency: { type: "string", enum: ["emergency", "same_day", "standard"] },
    score: { type: "integer" },
    service_type: { type: "string", enum: SERVICE_TYPES },
    next_action: { type: "string" },
    address_confirmed: { type: "boolean" },
    address: { type: ["string", "null"] },
  },
  required: ["breakdown", "lead_level", "urgency", "score", "service_type", "next_action", "address_confirmed", "address"],
};

async function callGrok(key: string, userText: string, withReasoning: boolean) {
  const body: Record<string, unknown> = {
    model: GROK_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You analyse phone calls for 0800-BE-COOL, a South African HVAC (air conditioning) business. " +
          "Return JSON only. breakdown: 3-6 short bullet lines in plain English, each starting with '- '. " +
          "lead_level: hot (ready to buy/book now), warm (interested, needs follow-up), cold (unlikely/info only). " +
          "urgency: emergency, same_day or standard. score: 1-5 (5 = best lead). " +
          "next_action: one sentence for staff. address_confirmed: true only if the caller clearly confirmed a full address. " +
          "address: the address mentioned, or null.",
      },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_schema", json_schema: { name: "call_report", strict: true, schema } },
  };
  if (withReasoning) body.reasoning_effort = "low";
  return await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

async function analyse(call: any) {
  const key = Deno.env.get("XAI_API_KEY");
  if (!key) throw new Error("XAI_API_KEY not configured");
  const transcript = String(call.transcript ?? "").slice(0, 12000);
  const userText =
    `Caller name: ${call.caller_name ?? "unknown"}\nCaller phone: ${call.caller_phone ?? "unknown"}\n` +
    `Duration: ${call.duration_seconds ?? 0} seconds\nVapi summary: ${call.summary ?? "(none)"}\n\nTranscript:\n${transcript}`;
  let res = await callGrok(key, userText, true);
  if (res.status === 400) {
    const t = await res.text();
    if (/reasoning/i.test(t)) res = await callGrok(key, userText, false);
    else throw new Error(`Grok 400: ${t.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`Grok ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const out = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  out.score = Math.min(5, Math.max(1, Math.round(Number(out.score) || 1)));
  return out;
}

const last9 = (p: string) => p.replace(/\D/g, "").slice(-9);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: cfg } = await sb.from("app_webhook_config").select("call_report_token, email_webhook_token").eq("id", 1).single();
    const token = req.headers.get("x-call-report-token");
    if (!cfg?.call_report_token || token !== cfg.call_report_token) return json(401, { error: "UNAUTHORIZED" });

    const body = await req.json().catch(() => ({}));
    const callId = typeof body.call_id === "string" ? body.call_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(callId)) return json(400, { error: "call_id required" });
    const test = body.test === true;
    const force = body.force === true;

    const { data: call } = await sb.from("vapi_calls").select("*").eq("id", callId).maybeSingle();
    if (!call) return json(404, { error: "call not found" });

    const { data: existing } = await sb.from("call_reports").select("status").eq("call_id", callId).maybeSingle();
    if (existing?.status === "done" && !force) return json(200, { skipped: true, reason: "already done" });

    // Link lead (read only)
    let leadId: string | null = call.lead_id ?? null;
    let customerId: string | null = call.customer_id ?? null;
    if (!leadId && call.company_id && call.caller_phone) {
      const tail = last9(call.caller_phone);
      if (tail.length === 9) {
        const since = new Date(Date.now() - 14 * 864e5).toISOString();
        const { data: leads } = await sb
          .from("leads")
          .select("id, customer_id, phone, customer_phone, lead_status")
          .eq("company_id", call.company_id)
          .is("deleted_at", null)
          .not("lead_status", "in", "(completed,lost,cancelled)")
          .gte("created_at", since)
          .or(`phone.ilike.%${tail.slice(-4)}%,customer_phone.ilike.%${tail.slice(-4)}%`)
          .order("created_at", { ascending: false })
          .limit(20);
        const hit = (leads ?? []).find((l: any) =>
          last9(String(l.phone ?? "")) === tail || last9(String(l.customer_phone ?? "")) === tail);
        if (hit) { leadId = hit.id; customerId = customerId ?? hit.customer_id ?? null; }
      }
    }

    // Recipient
    let emailTo: string | null = null;
    const { data: setting } = await sb.from("admin_settings").select("setting_value").eq("setting_key", "call_report_email").maybeSingle();
    const sv = setting?.setting_value as any;
    if (typeof sv === "string" && sv.includes("@")) emailTo = sv;
    else if (sv && typeof sv.email === "string") emailTo = sv.email;
    if (!emailTo) {
      const { data: admins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
      const ids = (admins ?? []).map((a: any) => a.user_id);
      if (ids.length) {
        const { data: profs } = await sb.from("profiles").select("id, company_id").in("id", ids);
        const pick = (profs ?? []).find((p: any) => p.company_id && p.company_id === call.company_id)
          ?? (profs ?? []).find((p: any) => p.company_id);
        if (pick) {
          const { data: u } = await sb.auth.admin.getUserById(pick.id);
          emailTo = u?.user?.email ?? null;
        }
      }
    }

    const base = {
      call_id: callId, company_id: call.company_id, lead_id: leadId, customer_id: customerId,
      caller_phone: call.caller_phone, caller_name: call.caller_name, model: GROK_MODEL, is_test: test, email_to: emailTo,
    };

    let report: any = null;
    let errorText: string | null = null;
    try { report = await analyse(call); } catch (e) { errorText = String((e as Error)?.message ?? e); }

    const row: Record<string, unknown> = report
      ? { ...base, ...report, status: "done", error: null }
      : { ...base, status: "failed", error: errorText };
    const { data: saved, error: upErr } = await sb.from("call_reports").upsert(row, { onConflict: "call_id" }).select().single();
    if (upErr) throw upErr;

    // Lead updates (never in test mode)
    if (report && !test && leadId) {
      const { data: lead } = await sb.from("leads").select("lead_score, lead_priority").eq("id", leadId).maybeSingle();
      if (lead) {
        const patch: Record<string, unknown> = {};
        if (lead.lead_score == null) patch.lead_score = report.score;
        if ((lead.lead_priority == null || lead.lead_priority === "standard") && report.urgency !== "standard") patch.lead_priority = report.urgency;
        if (Object.keys(patch).length) await sb.from("leads").update(patch).eq("id", leadId);
      }
    }

    // Email
    let emailStatus: "sent" | "failed" | "skipped" = "skipped";
    let emailError: string | null = null;
    if (emailTo && cfg.email_webhook_token) {
      const who = call.caller_name || call.caller_phone || "Unknown caller";
      const when = new Date(call.started_at || call.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
      const dur = `${Math.floor((call.duration_seconds || 0) / 60)}m ${(call.duration_seconds || 0) % 60}s`;
      const prefix = test ? "[TEST] " : "";
      const subject = report
        ? `${prefix}[Call] ${report.lead_level.toUpperCase()} · ${report.urgency} · ${who}`
        : `${prefix}[Call] Report failed · ${who}`;
      const badge = (t: string, c: string) => `<span style="display:inline-block;padding:3px 10px;margin-right:6px;border-radius:12px;background:${c};color:#fff;font-size:12px;font-weight:bold;">${esc(t)}</span>`;
      const lvlColor: Record<string, string> = { hot: "#DC2626", warm: "#F59E0B", cold: "#6B7280" };
      const urgColor: Record<string, string> = { emergency: "#DC2626", same_day: "#F59E0B", standard: "#0077B6" };
      const rowHtml = (k: string, v: string) => `<tr><td style="padding:4px 8px;color:#6b7280;font-size:13px;width:140px;">${esc(k)}</td><td style="padding:4px 8px;font-size:14px;color:#111827;">${v}</td></tr>`;
      const html = `<!DOCTYPE html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;">
<h2 style="margin:0 0 12px;color:#0077B6;">${test ? "[TEST] " : ""}Call report</h2>
${report ? `<p>${badge(report.lead_level.toUpperCase(), lvlColor[report.lead_level])}${badge(report.urgency, urgColor[report.urgency])}${badge(`Score ${report.score}/5`, "#0077B6")}</p>` : `<p style="color:#DC2626;"><strong>Automatic analysis failed:</strong> ${esc(errorText)}</p>`}
<table style="border-collapse:collapse;width:100%;">
${rowHtml("Caller", esc(call.caller_name || "Unknown"))}
${rowHtml("Phone", esc(call.caller_phone))}
${rowHtml("Time", esc(when))}
${rowHtml("Duration", esc(dur))}
${report ? rowHtml("Service type", esc(report.service_type)) : ""}
${report ? rowHtml("Address confirmed", report.address_confirmed ? "Yes" : "No") : ""}
${report?.address ? rowHtml("Address", esc(report.address)) : ""}
${leadId ? rowHtml("Lead", `<a href="${APP_URL}/admin/dispatch?lead=${leadId}">Open lead (summary + full transcript)</a>`) : ""}
${call.provider === "vapi" && call.provider_call_id ? rowHtml("Recording", `<a href="${APP_URL}/admin/calls?call=${callId}">Listen to the recording in the app</a> (sign-in needed; recordings stay private)`) : ""}
</table>
${report ? `<h3 style="margin:16px 0 6px;font-size:15px;">Breakdown</h3><div style="font-size:14px;white-space:pre-wrap;">${esc(report.breakdown)}</div>
<h3 style="margin:16px 0 6px;font-size:15px;">Next action</h3><p style="font-size:14px;margin:0;">${esc(report.next_action)}</p>` : ""}
${call.summary ? `<h3 style="margin:16px 0 6px;font-size:15px;">Vapi summary</h3><p style="font-size:13px;color:#374151;white-space:pre-wrap;margin:0;">${esc(call.summary)}</p>` : ""}
<p style="margin-top:20px;font-size:11px;color:#9ca3af;">Automated call report (Grok)</p>
</div></body></html>`;
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-email-webhook-token": String(cfg.email_webhook_token) },
          body: JSON.stringify({ to: emailTo, subject, html }),
        });
        emailStatus = r.ok ? "sent" : "failed";
        if (!r.ok) {
          const body = await r.text();
          emailError = `Email failed ${r.status}: ${body}`.slice(0, 2000);
          console.error("email failed", r.status, body);
        }
      } catch (e) {
        emailStatus = "failed";
        emailError = `Email error: ${String((e as Error)?.message ?? e)}`.slice(0, 2000);
        console.error("email error", e);
      }
    }
    const upd: Record<string, unknown> = { email_status: emailStatus, email_sent_at: emailStatus === "sent" ? new Date().toISOString() : null };
    if (emailError) upd.error = saved.error ? `${saved.error}\n${emailError}` : emailError;
    const { data: final } = await sb.from("call_reports")
      .update(upd)
      .eq("id", saved.id).select().single();

    return json(200, final ?? saved);
  } catch (e) {
    console.error("call-report error", e);
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
