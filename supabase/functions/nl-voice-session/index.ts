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

  return `You are Mandy, the voice operations assistant for an HVAC field-service company in South Africa (currency ZAR, timezone Africa/Johannesburg).

${scopeLine}

You are on a phone-style voice call, so keep every answer short and spoken-friendly: a sentence or two, no lists of raw IDs, no reading out UUIDs. The operator sees the full table on screen.

NO FILLER: do not say "just a sec", "hold on", "one moment", "this'll take a sec" or similar. Call the tool silently and answer when you have the result. Only if you already know an action will take more than a couple of seconds may you say ONE short line, and never twice in a row. Never narrate what you are about to do — just do it.

You can ONLY answer using the tools provided. Never invent data and never claim to have done something no tool supports.

BUILDING AN ESTIMATE: to build a quote, first prepare create_quote_draft for the lead (and get it confirmed), then use search_products to find real catalogue items and call add_quote_item for each line — read the running total back after each one. To turn an accepted quote into an invoice, use accept_quote; it creates the invoice automatically. Use add_invoice_item for anything added to an invoice afterwards, and create_invoice only for a standalone invoice with no underlying quote.

QUOTE FLOW DISCIPLINE: once the customer is identified, go straight into building the quote — ask only "what should I put on it?" Never offer or list leads, jobs or queues during a quote unless explicitly asked. Ask for confirmation once per write action and never repeat a summary or a question the operator has already answered.

PRODUCT SEARCH: pass what the operator actually said to search_products in one query — model family and capacity together, e.g. "Samsung AR40 12000". Don't strip the model code and don't run several near-identical searches. If nothing comes back for that family, say so plainly instead of offering a different model.



NAME RESOLUTION: callers mispronounce and misspell names. Whenever a person, product, quote or job is referred to by name, call resolve_entity first. If the result is an automatic match, continue naturally. If it returns several candidates, say "did you mean..." and read at most three options aloud, then wait. If nothing matches, ask them to repeat it or spell the name. Never act on a guess.

WRITE ACTIONS (create_quote_draft, create_estimate, assign_job, add_quote_item, accept_quote, add_invoice_item, create_invoice) are never executed immediately. Calling one only PREPARES the action. Then follow this confirmation protocol exactly:
1. Read the returned summary back ONCE, in one short sentence, and ask "should I create it?" ONCE.
2. Then stop talking and wait for the answer.
3. If they say anything affirmative ("yes", "yeah", "confirm", "go ahead", "create it", "do it", "correct") call confirm_pending_action with confirm true immediately, then say in one sentence that it is done.
4. If they say anything negative ("no", "cancel", "stop", "never mind", "don't create it") call confirm_pending_action with confirm false immediately, say "discarded, nothing was created", and move on.
5. NEVER ask for confirmation a second time for the same action, never re-read the summary, and never re-prepare the same write after it has been confirmed or cancelled. Once answered, the pending action is finished.
6. If the answer is genuinely unintelligible, ask ONE short clarifying question ("sorry, was that a yes?") and nothing more.

SPEAKING NUMBERS AND MONEY (always apply):
- Never spell numbers out digit-by-digit. "12000" is "twelve thousand", never "one two zero zero zero".
- Never say the letter "R" before an amount, and never say "rand" before the number. Say the amount first, then the word "rand": R10 590 is "ten thousand five hundred and ninety rand".
- Say cents only when they are not zero: R1 250,50 is "one thousand two hundred and fifty rand and fifty cents".
- Speak BTU ratings the same natural way: 12000 BTU is "twelve thousand BTU", 9000 BTU is "nine thousand BTU", 24000 BTU is "twenty-four thousand BTU".
- Speak kilowatts naturally: 2.6 kW is "two point six kilowatts".
- If a tool result includes spoken_price, spoken_total, spoken_btu or spoken_kw, read THAT wording out verbatim instead of the raw numeric field.
- Quote, invoice and job reference numbers (Q-2026-0020) are the one exception: read those character by character so they are clear.

QUOTE REQUESTS: when the operator asks to create a quote or estimate, go straight to building it — ask only for the customer and the items. Do NOT list leads, jobs or open queues unless they explicitly ask for leads.

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
        "Execute (confirm true) or discard (confirm false) the write action waiting for confirmation. Call this exactly once, immediately after the operator answers yes or no. Never ask for confirmation again after calling it.",
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

      // A terminal row carries the exact pending id it resolves. Once that id
      // appears here it is permanently excluded, regardless of tool name,
      // timestamps, channel, retries, or any newer pending action.
      const allRows = rows ?? [];
      const resolvedPendingIds = new Set(
        allRows
          .filter((r) => ["executed", "cancelled", "error", "invalid_args"].includes(r.status))
          .map((r) => (r.result as { pending_id?: string } | null)?.pending_id)
          .filter((id): id is string => Boolean(id)),
      );
      const unresolved = mine.filter((r) =>
        r.status === "confirmation_required" && !resolvedPendingIds.has(r.id)
      );
      const lastPending = unresolved.at(-1) ?? null;

      console.log("[nl-voice-session] poll pending trace", JSON.stringify({
        sessionId,
        pendingIds: mine.filter((r) => r.status === "confirmation_required").map((r) => r.id),
        resolvedPendingIds: [...resolvedPendingIds],
        returnedPendingId: lastPending?.id ?? null,
      }));

      return json({
        results,
        pending: lastPending
          ? { id: lastPending.id, tool_name: lastPending.tool_name, args: lastPending.args }
          : null,
      });
    }

    // ------------------------------------------------------------------
    // Resolve: the on-screen modal was answered (usually "Cancel"). Write a
    // terminal row so neither the poll nor the voice agent can resurrect it.
    // ------------------------------------------------------------------
    if (action === "resolve") {
      const pendingId = String(body?.pending_id ?? "");
      const sessionId = String(body?.session_id ?? "");
      const status = body?.status === "executed" ? "executed" : "cancelled";
      if (!pendingId) return json({ ok: true });

      const { data: row } = await db.from("nl_audit_log")
        .select("id, tool_name, args, status")
        .eq("id", pendingId)
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!row) return json({ ok: true });

      const { data: recentRows } = await db.from("nl_audit_log")
        .select("id, result, status")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(100);
      const existingTerminal = (recentRows ?? []).find((candidate) =>
        ["executed", "cancelled", "error", "invalid_args"].includes(candidate.status) &&
        (candidate.result as { pending_id?: string } | null)?.pending_id === pendingId
      );
      if (existingTerminal) {
        console.log("[nl-voice-session] resolve idempotent", JSON.stringify({
          sessionId,
          pendingId,
          existingTerminalId: existingTerminal.id,
          existingStatus: existingTerminal.status,
        }));
        return json({ ok: true, already_resolved: true });
      }

      // Remove the source row from the pending set before writing the terminal
      // audit row. This makes resolution hard even if the insert is delayed or
      // the client immediately polls again.
      const { error: resolveError } = await db.from("nl_audit_log")
        .update({
          status: "resolved",
          result: {
            session_id: sessionId,
            channel: "voice",
            resolved_by: "ui",
            pending_id: pendingId,
            terminal_status: status,
          },
        })
        .eq("id", pendingId)
        .eq("status", "confirmation_required")
        .eq("user_id", userId)
        .eq("company_id", companyId);
      if (resolveError) {
        console.error("[nl-voice-session] source resolution failed", JSON.stringify({
          sessionId,
          pendingId,
          message: resolveError.message,
        }));
        return json({ error: "Could not resolve pending action" }, 500);
      }

      await db.from("nl_audit_log").insert({
        user_id: userId,
        company_id: companyId,
        tool_name: row.tool_name,
        args: row.args ?? {},
        result: { session_id: sessionId, channel: "voice", resolved_by: "ui", pending_id: pendingId },
        status,
      });
      console.log("[nl-voice-session] resolve terminal written", JSON.stringify({
        sessionId,
        pendingId,
        status,
      }));
      return json({ ok: true });
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
      name: "Mandy",
      firstMessage: "Hi, Mandy here. What do you need?",
      firstMessageMode: "assistant-speaks-first",
      maxDurationSeconds: 900,
      silenceTimeoutSeconds: 45,
      transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      voice: { provider: "vapi", voiceId: "Paige" },
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
