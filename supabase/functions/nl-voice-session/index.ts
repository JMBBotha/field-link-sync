import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicTools, TOOL_KIND, type ToolName } from "../_shared/nlTools.ts";
import { signSession } from "../_shared/voiceSession.ts";

/**
 * Issues a Vapi voice session for the operations assistant.
 *
 * The voice assistant is configured with the SAME whitelisted tools as the
 * text assistant (nl-query). Tool execution never happens here — every tool
 * is pointed at the `nl-voice-tool` webhook, which reuses the shared Zod
 * schemas, company scoping, PII allow-list and nl_audit_log.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SYSTEM_PROMPT =
  `You are the voice operations assistant for an HVAC field-service company in South Africa (currency ZAR, timezone Africa/Johannesburg).

You are on a phone-style voice call, so keep every answer short and spoken-friendly: a sentence or two, no lists of raw IDs, no reading out UUIDs. The operator sees the full table on screen.

You can ONLY answer using the tools provided. Never invent data and never claim to have done something no tool supports.

WRITE ACTIONS (create_quote_draft, assign_job) are never executed immediately. Calling them only prepares the action. After calling one, read the key details back to the operator and ask "should I confirm that?". Only when they clearly say yes (for example "yes, confirm") do you call confirm_pending_action with confirm set to true. If they say no, call confirm_pending_action with confirm set to false.

Today's date is ${new Date().toISOString().slice(0, 10)}.`;

function vapiTools(serverUrl: string) {
  const tools = anthropicTools.map((t) => ({
    type: "function",
    async: false,
    server: { url: serverUrl },
    function: {
      name: t.name,
      description: TOOL_KIND[t.name as ToolName] === "write"
        ? `${t.description} Calling this only PREPARES the action; it does not run until confirm_pending_action is called.`
        : t.description,
      parameters: {
        type: "object",
        properties: t.input_schema.properties,
        required: (t.input_schema as { required?: string[] }).required ?? [],
      },
    },
  }));

  tools.push({
    type: "function",
    async: false,
    server: { url: serverUrl },
    function: {
      name: "confirm_pending_action",
      description:
        "Execute (or discard) the write action that is waiting for confirmation. Only call this after the operator has clearly said yes or no out loud.",
      parameters: {
        type: "object",
        properties: {
          confirm: { type: "boolean", description: "true to run the action, false to discard it" },
        },
        required: ["confirm"],
      },
    },
  } as (typeof tools)[number]);

  return tools;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsError || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = String(claimsData.claims.sub);

    const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: profile } = await db.from("profiles")
      .select("company_id").eq("id", userId).maybeSingle();
    const companyId: string | null = profile?.company_id ?? null;
    if (!companyId) {
      return json({
        error: "Your account is not linked to a company yet, so the assistant has no data to work with.",
      }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "start");

    // ------------------------------------------------------------------
    // Poll: the tool webhook runs out-of-band (Vapi calls it), so the panel
    // polls for anything the voice call produced — result rows to render and
    // any write action waiting on the on-screen confirmation fallback.
    // ------------------------------------------------------------------
    if (action === "poll") {
      const sessionId = String(body?.session_id ?? "");
      if (!sessionId) return json({ error: "session_id required" }, 400);

      const { data: rows } = await db.from("nl_audit_log")
        .select("id, tool_name, args, result, status, created_at")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: true })
        .limit(60);

      const mine = (rows ?? []).filter((r) =>
        (r.result as { session_id?: string } | null)?.session_id === sessionId
      );

      const results = mine
        .filter((r) => r.status === "executed")
        .map((r) => ({
          id: r.id,
          tool_name: r.tool_name,
          rows: ((r.result as { rows?: Record<string, unknown>[] } | null)?.rows) ?? [],
          summary: (r.result as { summary?: string } | null)?.summary ?? "",
        }));

      // A pending write is the newest confirmation_required row that has not
      // been resolved by a later executed/cancelled row.
      const lastPending = [...mine].reverse().find((r) => r.status === "confirmation_required");
      const resolvedAfter = lastPending
        ? mine.some((r) =>
          ["executed", "cancelled", "error"].includes(r.status) &&
          r.tool_name === lastPending.tool_name &&
          r.created_at > lastPending.created_at
        )
        : true;

      return json({
        results,
        pending: lastPending && !resolvedAfter
          ? { tool_name: lastPending.tool_name, args: lastPending.args }
          : null,
      });
    }

    // ------------------------------------------------------------------
    // Start: mint a scoped session token and return the transient assistant.
    // ------------------------------------------------------------------
    const publicKey = Deno.env.get("VAPI_PUBLIC_KEY");
    if (!publicKey) {
      return json({
        error: "Voice mode is not configured yet — the VAPI_PUBLIC_KEY secret is missing.",
      }, 503);
    }

    const { token, sessionId } = await signSession(userId, companyId);
    const serverUrl = `${supabaseUrl}/functions/v1/nl-voice-tool?s=${encodeURIComponent(token)}`;

    return json({
      publicKey,
      sessionId,
      assistant: {
        name: "Operations Assistant",
        firstMessage: "Operations assistant here. What do you need?",
        firstMessageMode: "assistant-speaks-first",
        maxDurationSeconds: 900,
        silenceTimeoutSeconds: 45,
        transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
        voice: { provider: "vapi", voiceId: "Elliot" },
        model: {
          provider: "openai",
          model: "gpt-4o",
          temperature: 0.2,
          messages: [{ role: "system", content: SYSTEM_PROMPT }],
          tools: vapiTools(serverUrl),
        },
      },
    });
  } catch (e) {
    console.error("[nl-voice-session] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
