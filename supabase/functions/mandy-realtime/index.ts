/**
 * mandy-realtime — ephemeral token for dashboard Mandy's speech-to-speech session.
 *
 * The browser connects to wss://api.x.ai/v1/realtime with the returned client
 * secret (sec-websocket-protocol: xai-client-secret.<token>). XAI_API_KEY
 * stays on the server. Tool execution stays in the browser under the user's
 * JWT. This function does not read or write quotes.
 *
 * Not used by the phone assistant. The batch mandy-agent path is unchanged.
 *
 * Actions:
 *   session  { tools, context, client_build } → { token, expires_at, url, session }
 *   tools    { tools, context, client_build } → { url, session }  (no new token)
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";
import { tierFor, safeVoice, safeBotName, mandyPlanOff, MANDY_OFF_TEXT, type MandyTier } from "../_shared/mandyPolicy.ts";
import { clientBuildTooOld, prepareRealtimeSession, readClientSecret, MANDY_CLIENT_SECRET_SECONDS } from "../_shared/mandyRealtime.ts";

const cors = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MIN_CLIENT_BUILD = Deno.env.get("MANDY_MIN_CLIENT_BUILD") || "20260925200552";
const STALE_TEXT = "This Field Lynk tab is running an old version. Please refresh with Ctrl+Shift+R (or close and reopen the app), then try again. Your sign-in stays.";

type MandyCtx = { tier: MandyTier; companyId: string | null; companyName: string; botName: string; voice: string; parent: boolean; off: boolean };

/** Same company / role lookup as mandy-agent. Least privilege if it fails. */
async function loadCtx(userId: string | null, roles: string[]): Promise<MandyCtx> {
  const fallback: MandyCtx = { tier: "viewer", companyId: null, companyName: "", botName: "Mandy", voice: "liora", parent: false, off: false };
  if (!userId) return fallback;
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const [{ data: prof }, sales, tech, par] = await Promise.all([
      db.from("profiles").select("company_id").eq("id", userId).maybeSingle(),
      db.rpc("is_sales_rep", { _uid: userId }),
      db.rpc("is_field_tech_only", { _uid: userId }),
      db.rpc("is_parent_owner", { _uid: userId }),
    ]);
    const companyId = (prof as { company_id?: string } | null)?.company_id ?? null;
    let companyName = ""; let botName = "Mandy"; let voice = "liora"; let off = false;
    if (companyId) {
      const [{ data: co }, { data: cfg }] = await Promise.all([
        db.from("companies").select("name, mandy_enabled, plan_status").eq("id", companyId).maybeSingle(),
        db.from("company_assistant_config").select("bot_name, voice_id").eq("company_id", companyId).maybeSingle(),
      ]);
      companyName = String((co as { name?: string } | null)?.name ?? "");
      off = mandyPlanOff(co as { mandy_enabled?: boolean; plan_status?: string } | null);
      botName = safeBotName((cfg as { bot_name?: string } | null)?.bot_name);
      voice = safeVoice((cfg as { voice_id?: string } | null)?.voice_id);
    }
    return { tier: tierFor(roles, { salesRep: sales.data === true, techOnly: tech.data === true }), companyId, companyName, botName, voice, parent: par.data === true, off };
  } catch {
    return fallback;
  }
}

/** Active playbook lines for this company and role. Missing table must not block a session. */
async function loadPlaybook(companyId: string | null, tier: string): Promise<string> {
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data, error } = await db.from("mandy_playbook").select("title, answer, allowed_roles, company_id, active").eq("active", true).limit(20);
    if (error || !data) return "";
    const rows = (data as { title?: string; answer?: string; allowed_roles?: string[]; company_id?: string | null }[])
      .filter((r) => (!r.company_id || r.company_id === companyId) && ((r.allowed_roles || []).includes("all") || (r.allowed_roles || []).includes(tier)));
    let used = 0;
    const parts: string[] = [];
    for (const r of rows) {
      const line = `${r.title}: ${String(r.answer || "").replace(/\s+/g, " ")}`.trim();
      if (!line || used + line.length > 1600) break;
      parts.push(line);
      used += line.length + 1;
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const action = String(body.action ?? "session");
  if (action !== "session" && action !== "tools") return json({ error: `Unknown action ${action}` }, 400);

  const mctx = await loadCtx(auth.userId, auth.roles);
  if (mctx.off) return json({ off: true, text: MANDY_OFF_TEXT });
  if (clientBuildTooOld(body.client_build, MIN_CLIENT_BUILD)) return json({ stale_client: true, text: STALE_TEXT });

  const playbook = await loadPlaybook(mctx.companyId, mctx.tier);
  const prepared = prepareRealtimeSession({
    tier: mctx.tier,
    parent: mctx.parent,
    botName: mctx.botName,
    companyName: mctx.companyName,
    tools: Array.isArray(body.tools) ? body.tools : [],
    context: body.context && typeof body.context === "object" ? body.context : {},
    playbook,
  });
  // Company voice_id is kept for the legacy TTS path. Realtime is pinned to eve.
  void mctx.voice;

  if (action === "tools") {
    return json({ url: prepared.url, session: prepared.session, tier: mctx.tier, dropped_tools: prepared.dropped.length ? prepared.dropped : undefined });
  }

  const key = Deno.env.get("XAI_API_KEY");
  if (!key) return json({ error: "Mandy is not configured — add the secret XAI_API_KEY." }, 500);
  const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: MANDY_CLIENT_SECRET_SECONDS } }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof raw === "object" && raw ? JSON.stringify(raw).slice(0, 180) : "";
    return json({ error: `Voice link failed (${res.status}). ${detail}`.trim() }, res.status === 401 ? 502 : 502);
  }
  const secret = readClientSecret(raw);
  if (!secret) return json({ error: "Voice link did not return a client secret." }, 502);
  return json({
    token: secret.token,
    expires_at: secret.expiresAt,
    url: prepared.url,
    session: prepared.session,
    tier: mctx.tier,
    dropped_tools: prepared.dropped.length ? prepared.dropped : undefined,
  });
});
