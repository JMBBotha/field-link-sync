import { createClient } from "npm:@supabase/supabase-js@2";
import { anthropicTools, TOOL_KIND, type ToolName } from "../_shared/nlTools.ts";
import { OPS_ROLES } from "../_shared/recordAccess.ts";
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

function buildSystemPrompt(callerName: string, isOps: boolean, roleLabel: string): string {
  const scopeLine = isOps
    ? `You are talking with ${callerName}, a ${roleLabel} — they have full access to every client, lead, job, quote and invoice across the company.`
    : `You are talking with ${callerName}, a ${roleLabel} — they can only see and act on their OWN leads, jobs, quotes, invoices and the customers tied to those, never a colleague's. This is enforced automatically; if something comes back empty or fails because it isn't theirs, just tell them plainly rather than mentioning permissions or access levels.`;

  return `You are the voice operations assistant for an HVAC field-service company in South Africa (currency ZAR, timezone Africa/Johannesburg).

${scopeLine}

You are on a phone-style voice call, so keep every answer short and spoken-friendly: a sentence or two, no lists of raw IDs, no reading out UUIDs. The operator sees the full table on screen.

You can ONLY answer using the tools provided. Never invent data and never claim to have done something no tool supports.

BUILDING AN ESTIMATE: to build a quote, first prepare create_quote_draft for the lead (and get it confirmed), then use search_products to find real catalogue items and call add_quote_item for each line — read the running total back after each one. To turn an accepted quote into an invoice, use accept_quote; it creates the invoice automatically. Use add_invoice_item for anything added to an invoice afterwards, and create_invoice only for a standalone invoice with no underlying quote.

NAME RESOLUTION: callers mispronounce and misspell names. Whenever a person, product, quote or job is referred to by name, call resolve_entity first. If the result is an automatic match, continue naturally. If it returns several candidates, say "did you mean..." and read at most three options aloud, then wait. If nothing matches, ask them to repeat it or spell the name. Never act on a guess.

WRITE ACTIONS (create_quote_draft, assign_job, add_quote_item, accept_quote, add_invoice_item, create_invoice) are never executed immediately. Calling them only prepares the action. After calling one, read the key details back to the operator and ask "should I confirm that?". Only when they clearly say yes (for example "yes, confirm") do you call confirm_pending_action with confirm set to true. If they say no, call confirm_pending_action with confirm set to false.

Today's date is ${new Date().toISOString().slice(0, 10)}.`;
}

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
      .select("company_id, full_name").eq("id", userId).maybeSingle();
    const companyId: string | null = profile?.company_id ?? null;
    if (!companyId) {
      return json({
        error: "Your account is not linked to a company yet, so the assistant has no data to work with.",
      }, 403);
    }
    const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
    const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    const isOps = roles.some((r) => OPS_ROLES.has(r));
    const SYSTEM_PROMPT = buildSystemPrompt(profile?.full_name || "the operator", isOps, roles[0] ?? "team member");

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

    // The assistant config. When a saved Vapi assistant exists we send this as
    // assistantOverrides so the session-scoped tool webhook URL (and the ops
    // system prompt) always win over whatever is stored in the dashboard.
    const assistantConfig = {
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
    };

    // Always start a TRANSIENT assistant. A saved dashboard assistant only
    // applies its own tool list; transient tool overrides are not reliably
    // merged, which made the model call tools it had never been given
    // ("Tool not recognized" for resolve_entity). Sending the whole config
    // inline guarantees the system prompt, all whitelisted tools and the
    // session-scoped nl-voice-tool webhook URL always travel together.

    // Tag the session as internal so the shared Vapi webhook never treats a
    // staff conversation with the ops assistant as an inbound customer call.
    const internalMetadata = { internal: true, source: "internal", surface: "ops_assistant" };

    return json({
      publicKey,
      sessionId,
      metadata: internalMetadata,
      assistant: { ...assistantConfig, metadata: internalMetadata },
    });



  } catch (e) {
    console.error("[nl-voice-session] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
