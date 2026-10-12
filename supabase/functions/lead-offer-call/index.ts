import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * lead-offer-call (12 Oct 2026) — phone eligible staff about a new lead (simple Twilio keypad version).
 * Who: DB lead_call_candidates (existing offer rules). Accept: DB lead_call_accept (atomic, first wins).
 * Ships OFF: needs lead_call_settings.enabled + from_number; test_only limits to the allowlist.
 * Actions:
 *   POST json {action:"start", lead_id, dry_run?}  (header x-lead-call-token)  -> plan + log, dial unless dry run
 *   POST ?a=twiml&id=<attempt>   (Twilio)  -> Say + Gather
 *   POST ?a=gather&id=<attempt>  (Twilio)  -> 1 accept / 2 pass
 *   POST ?a=status&id=<attempt>  (Twilio statusCallback) -> no-answer/busy/failed -> next person
 */
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SELF = `${SB_URL}/functions/v1/lead-offer-call`;
const XML = { "Content-Type": "text/xml; charset=utf-8" };
const JSONH = { "Content-Type": "application/json" };

import { e164, inCallHours, spokenOffer } from "../_shared/leadCall.ts";

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
const twiml = (inner: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: XML });
const say = (t: string) => `<Say voice="alice" language="en-GB">${esc(t)}</Say>`;

async function validTwilio(req: Request, url: string, form: URLSearchParams): Promise<boolean> {
  const sig = req.headers.get("x-twilio-signature");
  if (!sig || !TOKEN) return false;
  const data = url + [...form.keys()].sort().map((k) => k + form.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...mac)) === sig;
}

async function twilio(path: string, body: Record<string, string>) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/${path}`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

async function settingsFor(company: string) {
  const { data } = await db.from("lead_call_settings").select("*").eq("company_id", company).maybeSingle();
  return data as any;
}

async function dial(attemptId: string, s: any) {
  const { data: a } = await db.from("lead_call_attempts").select("*").eq("id", attemptId).single();
  if (!a || a.dry_run || !s?.enabled || !s?.from_number || !SID || !TOKEN) {
    await db.from("lead_call_attempts").update({ status: "dry_run", reason: "switched off / no voice number", updated_at: new Date().toISOString() }).eq("id", attemptId);
    return;
  }
  const r = await twilio("Calls.json", {
    To: a.phone, From: s.from_number, Url: `${SELF}?a=twiml&id=${a.id}`, Method: "POST",
    StatusCallback: `${SELF}?a=status&id=${a.id}`, StatusCallbackMethod: "POST", Timeout: String(s.ring_seconds ?? 25), MachineDetection: "Enable",
  });
  await db.from("lead_call_attempts").update(r.ok
    ? { status: "calling", twilio_call_sid: r.json.sid, updated_at: new Date().toISOString() }
    : { status: "failed", reason: String(r.json?.message ?? "twilio error").slice(0, 300), updated_at: new Date().toISOString() }).eq("id", a.id);
  if (!r.ok) await next(a.lead_id);
}

/** Sequential: dial the next queued person, if the lead is still free. */
async function next(leadId: string) {
  const { data: lead } = await db.from("leads").select("company_id, assigned_agent_id").eq("id", leadId).single();
  if (!lead || lead.assigned_agent_id) return;
  const s = await settingsFor(lead.company_id);
  if (s?.mode !== "sequential") return;
  const { data: busy } = await db.from("lead_call_attempts").select("id").eq("lead_id", leadId).eq("status", "calling").limit(1);
  if (busy?.length) return;
  const { data: q } = await db.from("lead_call_attempts").select("id").eq("lead_id", leadId).eq("status", "queued").order("position").limit(1);
  if (q?.length) await dial(q[0].id, s);
}

async function start(leadId: string, dryRun: boolean) {
  const { data: lead } = await db.from("leads").select("id, company_id, assigned_agent_id, primary_intent").eq("id", leadId).single();
  if (!lead) return { ok: false, reason: "lead not found" };
  const s = await settingsFor(lead.company_id);
  const log = (row: Record<string, unknown>) => db.from("lead_call_attempts").insert({ company_id: lead.company_id, lead_id: leadId, dry_run: dryRun, ...row }).select("id").single();
  if (!s) return { ok: false, reason: "no settings" };
  if (!s.enabled && !dryRun) return { ok: false, reason: "master switch off" };
  if (!inCallHours(s)) { await log({ status: "not_called", reason: "outside call hours" }); return { ok: true, called: 0, reason: "outside call hours" }; }
  if (!lead.primary_intent) { await log({ status: "not_called", reason: "work type unsure – admin to pick tech or sales" }); return { ok: true, called: 0, reason: "work type unsure" }; }
  const { data: cands, error } = await db.rpc("lead_call_candidates", { p_lead: leadId });
  if (error) return { ok: false, reason: error.message };
  const planned: any[] = [];
  for (const c of (cands ?? []) as any[]) {
    const phone = e164(c.phone);
    let skip: string | null = null;
    if (c.pref !== "call") skip = c.pref === "whatsapp" ? "prefers WhatsApp" : "prefers app";
    else if (s.test_only && !(s.allowlist ?? []).includes(c.profile_id)) skip = "not on test list";
    else if (!phone) skip = "no mobile number";
    planned.push({ ...c, phone, skip });
  }
  const callable = planned.filter((p) => !p.skip).slice(0, s.mode === "single" ? 1 : s.max_people);
  if (!callable.length) { await log({ status: "not_called", reason: planned.length ? "nobody set to receive calls" : "nobody fits this lead" }); }
  const ids: string[] = [];
  let pos = 0;
  for (const p of callable) {
    const { data } = await log({ profile_id: p.profile_id, person_name: p.full_name, phone: p.phone, position: ++pos, status: dryRun ? "dry_run" : "queued",
      reason: dryRun ? "test run (no call placed)" : null, slot_date: p.slot_date, slot_start: p.slot_start, minutes: p.minutes, km: p.km });
    if (data) ids.push(data.id);
  }
  if (!dryRun) {
    if (s.mode === "simultaneous") await Promise.all(ids.map((id) => dial(id, s)));
    else if (ids.length) await dial(ids[0], s);
  }
  return { ok: true, mode: s.mode, dry_run: dryRun, planned: planned.map((p) => ({ name: p.full_name, km: p.km, skip: p.skip })), queued: ids.length };
}

async function attemptWithLead(id: string) {
  const { data: a } = await db.from("lead_call_attempts").select("*").eq("id", id).single();
  if (!a) return null;
  const { data: l } = await db.from("leads").select("service_type, call_area, customer_address, scheduled_date, scheduled_time, assigned_agent_id, status").eq("id", a.lead_id).single();
  return { a, l };
}

function area(l: any): string {
  if (l?.call_area) return l.call_area;
  const parts = String(l?.customer_address ?? "").split(",").map((x: string) => x.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] ?? "";
}

/** Simultaneous: tell the other ringing people it's gone. */
async function endOthers(leadId: string, winnerId: string) {
  const { data: others } = await db.from("lead_call_attempts").select("id, twilio_call_sid").eq("lead_id", leadId).neq("id", winnerId).not("twilio_call_sid", "is", null);
  for (const o of others ?? []) {
    await twilio(`Calls/${o.twilio_call_sid}.json`, { Twiml: `<Response>${say("Sorry, this job has just been taken by someone else. Thank you.")}<Hangup/></Response>` }).catch(() => null);
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  try {
    if (!a) {
      const tok = req.headers.get("x-lead-call-token");
      const { data: cfg } = await db.from("app_webhook_config").select("lead_call_token").eq("id", 1).single();
      if (!tok || !cfg?.lead_call_token || tok !== cfg.lead_call_token) return new Response("forbidden", { status: 403 });
      const b = await req.json().catch(() => ({}));
      if (b.action !== "start" || !b.lead_id) return new Response(JSON.stringify({ ok: false, reason: "bad request" }), { status: 400, headers: JSONH });
      return new Response(JSON.stringify(await start(b.lead_id, !!b.dry_run)), { headers: JSONH });
    }

    const form = new URLSearchParams(await req.text());
    if (!(await validTwilio(req, SELF + url.search, form))) return new Response("forbidden", { status: 403 });
    const id = url.searchParams.get("id") ?? "";
    const x = await attemptWithLead(id);
    if (!x) return twiml(say("Sorry, this offer has expired.") + "<Hangup/>");
    const now = new Date().toISOString();

    if (a === "twiml") {
      if (x.l?.assigned_agent_id || form.get("AnsweredBy")?.startsWith("machine")) {
        if (!x.l?.assigned_agent_id) await db.from("lead_call_attempts").update({ status: "no_answer", reason: "voicemail", updated_at: now }).eq("id", id);
        return twiml(x.l?.assigned_agent_id ? say("Sorry, this job has already been taken. Thank you.") + "<Hangup/>" : "<Hangup/>");
      }
      const text = spokenOffer({ name: x.a.person_name, job: x.l?.service_type, area: area(x.l), date: x.a.slot_date ?? x.l?.scheduled_date, time: x.a.slot_start ?? x.l?.scheduled_time, minutes: x.a.minutes });
      return twiml(`<Gather numDigits="1" timeout="8" action="${esc(`${SELF}?a=gather&id=${id}`)}" method="POST">${say(text)}</Gather>` +
        `<Gather numDigits="1" timeout="8" action="${esc(`${SELF}?a=gather&id=${id}`)}" method="POST">${say("Press 1 to accept, or 2 to pass.")}</Gather>` +
        say("No answer received. Goodbye."));
    }

    if (a === "gather") {
      const d = form.get("Digits");
      if (d === "1") {
        const { data: r } = await db.rpc("lead_call_accept", { p_attempt: id });
        if ((r as any)?.ok) {
          await endOthers(x.a.lead_id, id);
          return twiml(say("Great, the job is yours. You'll find it in Field Lynk now. Goodbye."));
        }
        const taken = (r as any)?.reason === "taken";
        if (!taken) await next(x.a.lead_id);
        return twiml(say(taken ? "Sorry, someone else has already taken this job. Thank you." : "Sorry, we couldn't book it for you. Please check Field Lynk. Goodbye."));
      }
      await db.from("lead_call_attempts").update({ status: "passed", digits: d ?? "", updated_at: now }).eq("id", id).in("status", ["calling", "queued"]);
      return twiml(say("No problem, thank you. Goodbye."));
    }

    if (a === "status") {
      const st = form.get("CallStatus");
      if (["no-answer", "busy", "failed", "canceled"].includes(st ?? "")) {
        await db.from("lead_call_attempts").update({ status: st === "failed" ? "failed" : "no_answer", reason: st, updated_at: now }).eq("id", id).eq("status", "calling");
      } else if (st === "completed") {
        await db.from("lead_call_attempts").update({ status: "no_answer", reason: "hung up without pressing", updated_at: now }).eq("id", id).eq("status", "calling");
      }
      if (["no-answer", "busy", "failed", "canceled", "completed"].includes(st ?? "")) await next(x.a.lead_id);
      return new Response("", { status: 204 });
    }
    return new Response("unknown action", { status: 400 });
  } catch (e) {
    console.error("lead-offer-call", e);
    return a ? twiml(say("Sorry, something went wrong. Please check Field Lynk.")) : new Response(JSON.stringify({ ok: false, reason: String(e) }), { status: 500, headers: JSONH });
  }
});
