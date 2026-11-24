/**
 * mandy-handoff — store a dashboard Mandy hand-off for the build team.
 * Insert uses the service role. Phone Mandy / Vapi does not call this.
 *
 * A new row is posted to MANDY_HANDOFF_WEBHOOK_URL with
 * Authorization: Bearer <MANDY_HANDOFF_WEBHOOK_SECRET> and
 * X-Hub-Signature-256 over the raw body (HMAC-SHA256, same secret).
 * The post runs after the reply, retries once, and writes webhook_status
 * on the row. Mandy still gets ok when the webhook is down or unset.
 * action "resend_undelivered" is service-role only and is not scheduled.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";
import { tierFor } from "../_shared/mandyPolicy.ts";
import {
  RESEND_UNDELIVERED_LIMIT,
  asSavedHandoff,
  buildHandoffWebhookBody,
  currentWaitUntil,
  postHandoffWebhook,
  resendUndelivered,
  scheduleAfterReply,
  type DeliveryResult,
} from "../_shared/mandyHandoffWebhook.ts";

const cors = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Db = ReturnType<typeof createClient>;

type HandoffSendRow = {
  id: string;
  company_id: string | null;
  user_id: string | null;
  role: string | null;
  summary: string;
  transcript: string | null;
  created_at: string;
  user_name?: string | null;
  webhook_attempts?: number | null;
};

function serviceDb(): Db {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function deliverStoredHandoff(db: Db, row: HandoffSendRow): Promise<DeliveryResult> {
  try {
    let userName = row.user_name ?? null;
    if (!("user_name" in row) && row.user_id) {
      const { data: prof } = await db.from("profiles").select("full_name").eq("id", row.user_id).maybeSingle();
      userName = (prof as { full_name?: string | null } | null)?.full_name ?? null;
    }
    const { raw } = buildHandoffWebhookBody({
      id: row.id,
      company_id: row.company_id,
      user_name: userName,
      role: row.role,
      created_at: row.created_at,
      summary: row.summary,
      transcript: row.transcript,
    });
    const result = await postHandoffWebhook({
      url: Deno.env.get("MANDY_HANDOFF_WEBHOOK_URL"),
      secret: Deno.env.get("MANDY_HANDOFF_WEBHOOK_SECRET"),
      rawBody: raw,
    });
    const prior = Number(row.webhook_attempts ?? 0) || 0;
    await db.from("mandy_handoffs").update({
      webhook_status: result.status,
      webhook_error: result.error,
      webhook_attempts: prior + result.attempts,
      webhook_sent_at: result.status === "delivered" ? new Date().toISOString() : null,
    }).eq("id", row.id);
    return result;
  } catch {
    return { status: "failed", error: "delivery failed before the webhook responded", attempts: 0 };
  }
}

async function runResendUndelivered(db: Db) {
  const { data, error } = await db.from("mandy_handoffs")
    .select("id, company_id, user_id, role, summary, transcript, created_at, status, webhook_status, webhook_attempts")
    .eq("status", "open")
    .in("webhook_status", ["pending", "failed", "skipped"])
    .order("created_at", { ascending: true })
    .limit(RESEND_UNDELIVERED_LIMIT);
  if (error) return { ok: false, error: "Could not list undelivered hand-offs.", considered: 0, delivered: 0, failed: 0, skipped: 0 };
  const rows = (data ?? []) as Array<HandoffSendRow & { status: string; webhook_status: string }>;
  return resendUndelivered(rows, (handoff) => deliverStoredHandoff(db, handoff));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request body." }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const db = serviceDb();

  // Manual recovery for open rows. Nothing in the app or in cron calls this.
  if (body.action === "resend_undelivered") {
    if (auth.userId) return json({ error: "Forbidden" }, 403);
    return json(await runResendUndelivered(db));
  }

  const summary = String(body.summary ?? "").trim().slice(0, 2000);
  if (!summary) return json({ error: "summary required" }, 400);

  let companyId: string | null = null;
  let userName: string | null = null;
  if (auth.userId) {
    const { data: prof } = await db.from("profiles").select("company_id, full_name").eq("id", auth.userId).maybeSingle();
    const profile = prof as { company_id?: string | null; full_name?: string | null } | null;
    companyId = profile?.company_id ?? null;
    userName = profile?.full_name ?? null;
  }
  const sales = auth.userId ? await db.rpc("is_sales_rep", { _uid: auth.userId }) : { data: false };
  const tech = auth.userId ? await db.rpc("is_field_tech_only", { _uid: auth.userId }) : { data: false };
  const role = tierFor(auth.roles, { salesRep: sales.data === true, techOnly: tech.data === true });
  const page = typeof body.page === "string" ? body.page.slice(0, 300) : null;
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 4000) : null;
  const entityIds = body.entity_ids && typeof body.entity_ids === "object" ? body.entity_ids : {};

  const savedRpc = await db.rpc("save_mandy_handoff", {
    p_company_id: companyId,
    p_user_id: auth.userId,
    p_role: role,
    p_page: page,
    p_entity_ids: entityIds,
    p_transcript: transcript,
    p_summary: summary,
  });
  const saved = asSavedHandoff(savedRpc.data);
  if (savedRpc.error || !saved) {
    const missing = /save_mandy_handoff/i.test(savedRpc.error?.message ?? "") && /does not exist/i.test(savedRpc.error?.message ?? "");
    if (!missing) return json({ error: "Could not store the hand-off." }, 500);
    const { data, error } = await db.from("mandy_handoffs").insert({
      company_id: companyId,
      user_id: auth.userId,
      role,
      page,
      entity_ids: entityIds,
      transcript,
      summary,
      status: "open",
    }).select("id").maybeSingle();
    if (error || !data?.id) return json({ error: "Could not store the hand-off." }, 500);
    return json({ ok: true, id: data.id, deduped: false });
  }

  if (!saved.deduped) {
    scheduleAfterReply(deliverStoredHandoff(db, {
      id: saved.id,
      company_id: companyId,
      user_id: auth.userId,
      role,
      summary,
      transcript,
      created_at: saved.created_at,
      user_name: userName,
      webhook_attempts: 0,
    }), currentWaitUntil());
  }
  return json({ ok: true, id: saved.id, deduped: saved.deduped });
});
