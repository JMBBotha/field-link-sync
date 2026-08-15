import { createClient } from "npm:@supabase/supabase-js@2";
import {
  anthropicTools,
  executeTool,
  TOOL_KIND,
  toolSchemas,
  type ToolName,
} from "../_shared/nlTools.ts";
import { OPS_ROLES } from "../_shared/recordAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const RATE_LIMIT = 15; // requests
const RATE_WINDOW_MS = 60_000; // per minute
const MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ROUNDS = 4;

function buildSystemPrompt(callerName: string, isOps: boolean, roleLabel: string): string {
  const scopeLine = isOps
    ? `${callerName} is a ${roleLabel} with FULL access to every client, lead, job, quote and invoice across the company.`
    : `${callerName} is a ${roleLabel}. They can only see and act on THEIR OWN leads, jobs, quotes, invoices and the customers tied to those — never another agent's clients or company-wide records. The tools already enforce this scoping server-side; if a query or write returns nothing or fails because a record isn't theirs, tell them plainly you couldn't find it or that it's outside what they have access to. NEVER say "access denied", "restricted", "you don't have permission" for get_quote/get_invoice lookups specifically — for those, just say you couldn't find it, to avoid confirming a hidden record exists. For other tools (e.g. add_quote_item on someone else's quote) it's fine to say plainly that it isn't theirs.`;

  return `You are the operations assistant for an HVAC field-service company in South Africa (currency ZAR, timezone Africa/Johannesburg).

${scopeLine}

You can ONLY answer using the tools provided. You have no database access beyond them and you must never invent data.
- Never claim to have performed an action that no tool supports (for example bulk cancelling jobs, deleting records, sending messages, or editing prices). Politely say you cannot do that and suggest what is possible.
- create_quote_draft, assign_job, add_quote_item, accept_quote, add_invoice_item and create_invoice are write actions: they are never executed by you, they are queued for the user's explicit confirmation. After requesting one, tell the user you have prepared it and are waiting for confirmation.
- BUILDING AN ESTIMATE: to build a quote, first create_quote_draft for the lead, then use search_products to find real catalogue items and call add_quote_item (with product_id, or a free-text description + unit_price) for each line — you can call it multiple times to add several items. Read the running total back after each item.
- TURNING A QUOTE INTO AN INVOICE: once a quote has been accepted by the customer, call accept_quote — this automatically creates the invoice from the quote's items. Use add_invoice_item afterwards for anything added later (e.g. a call-out fee). Only use create_invoice for a standalone invoice that has no underlying quote at all.
- get_quote and get_invoice open existing records. If they return no rows, say plainly that you could not find that quote/invoice. NEVER say "access denied", "you do not have permission", "restricted" or anything implying the record exists but is hidden.
- NAME RESOLUTION: when the user refers to a customer, lead, job, quote, product or staff member by name and the spelling or exact record is uncertain, call resolve_entity FIRST. If it returns decision 'auto' you may proceed with that record. If it returns candidates without an auto pick, read the options back and ask "did you mean ...?" before doing anything. If it returns nothing, ask them to repeat, refine or spell it. Never run a write action on an unconfirmed fuzzy match.
- Keep answers short and factual. When you list records, summarise the key points instead of repeating every field; the UI renders the full table.
- Today's date is ${new Date().toISOString().slice(0, 10)}.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsError || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = String(claimsData.claims.sub);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // --- rate limiting -------------------------------------------------
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await db.from("nl_request_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT) {
      return json({ error: "Rate limit reached. Please wait a minute and try again." }, 429);
    }
    await db.from("nl_request_log").insert({ user_id: userId });

    // --- caller scope ---------------------------------------------------
    const { data: profile } = await db.from("profiles")
      .select("company_id, full_name").eq("id", userId).maybeSingle();
    const companyId: string | null = profile?.company_id ?? null;
    // No company means no access — never fall back to unscoped, cross-tenant queries.
    if (!companyId) {
      return json({
        error: "Your account is not linked to a company yet, so the assistant has no data to work with.",
      }, 403);
    }
    const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
    const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    const isOps = roles.some((r) => OPS_ROLES.has(r));
    const SYSTEM_PROMPT = buildSystemPrompt(
      profile?.full_name || "The signed-in user",
      isOps,
      roles[0] ?? "team member",
    );
    const ctx = { db, rlsDb: anonClient, userId, companyId, roles };

    const body = await req.json().catch(() => ({}));

    const audit = async (
      tool: string,
      args: unknown,
      result: unknown,
      status: string,
      resource?: { resource_type?: string; resource_id?: string | null; access_granted?: boolean },
    ) => {
      await db.from("nl_audit_log").insert({
        user_id: userId,
        company_id: companyId,
        tool_name: tool,
        args: args ?? {},
        result: result ?? null,
        status,
        resource_type: resource?.resource_type ?? null,
        resource_id: resource?.resource_id ?? null,
        access_granted: resource?.access_granted ?? null,
      });
    };

    // ===================================================================
    // MODE 1: confirmed write execution
    // ===================================================================
    if (body?.confirm) {
      const toolName = String(body.confirm.tool_name ?? "") as ToolName;
      if (!(toolName in toolSchemas) || TOOL_KIND[toolName] !== "write") {
        await audit(toolName || "unknown", body.confirm?.args, { error: "not_whitelisted" }, "rejected");
        return json({ error: "That action is not available." }, 400);
      }
      const parsed = toolSchemas[toolName].safeParse(body.confirm.args ?? {});
      if (!parsed.success) {
        await audit(toolName, body.confirm.args, { error: parsed.error.issues }, "invalid_args");
        return json({ error: "Invalid arguments for this action." }, 400);
      }
      try {
        const out = await executeTool(toolName, parsed.data, ctx);
        await audit(toolName, parsed.data, out, "executed", out);
        return json({ type: "executed", tool_name: toolName, message: out.summary, data: out.rows });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Execution failed";
        await audit(toolName, parsed.data, { error: message }, "error");
        return json({ error: message }, 400);
      }
    }

    // ===================================================================
    // MODE 2: natural-language turn
    // ===================================================================
    const history = Array.isArray(body?.messages) ? body.messages.slice(-10) : [];
    const messages: Array<Record<string, unknown>> = history
      .filter((m: { role?: string; content?: unknown }) =>
        (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim()
      )
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: String(m.content).slice(0, 4000),
      }));

    if (messages.length === 0) return json({ error: "No message provided" }, 400);

    let pendingConfirmation: { tool_name: string; args: unknown } | null = null;
    const structured: Array<{ tool_name: string; rows: Record<string, unknown>[] }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: anthropicTools,
          messages,
        }),
      });

      if (res.status === 429) return json({ error: "The assistant is busy. Try again shortly." }, 429);
      if (!res.ok) {
        const detail = await res.text();
        console.error("[nl-query] anthropic error", res.status, detail);
        let upstream = "";
        try {
          upstream = JSON.parse(detail)?.error?.message ?? "";
        } catch { /* ignore */ }
        return json({
          error: upstream ? `Anthropic: ${upstream}` : "The assistant is unavailable right now.",
        }, 502);

      }

      const payload = await res.json();
      const content: Array<Record<string, any>> = payload.content ?? [];
      const textOut = content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      const toolUses = content.filter((c) => c.type === "tool_use");

      if (toolUses.length === 0 || payload.stop_reason !== "tool_use") {
        return json({
          type: "answer",
          message: textOut || "I could not find an answer for that.",
          data: structured,
        });
      }

      messages.push({ role: "assistant", content });
      const toolResults: Array<Record<string, unknown>> = [];

      for (const use of toolUses) {
        const name = String(use.name) as ToolName;

        if (!(name in toolSchemas)) {
          await audit(String(use.name), use.input, { error: "not_whitelisted" }, "rejected");
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: "That tool does not exist. Tell the user you cannot perform that action.",
          });
          continue;
        }

        const parsed = toolSchemas[name].safeParse(use.input ?? {});
        if (!parsed.success) {
          await audit(name, use.input, { error: parsed.error.issues }, "invalid_args");
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
          });
          continue;
        }

        if (TOOL_KIND[name] === "write") {
          pendingConfirmation = { tool_name: name, args: parsed.data };
          await audit(name, parsed.data, { status: "awaiting_confirmation" }, "confirmation_required");
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: "Queued for user confirmation. It has NOT run yet. Tell the user to confirm in the dialog.",
          });
          continue;
        }

        try {
          const out = await executeTool(name, parsed.data, ctx);
          await audit(name, parsed.data, { count: out.rows.length, summary: out.summary }, "executed", out);
          structured.push({ tool_name: name, rows: out.rows });
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify({ summary: out.summary, rows: out.rows.slice(0, 25) }),
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Tool failed";
          await audit(name, parsed.data, { error: message }, "error");
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: message,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      if (pendingConfirmation) {
        return json({
          type: "confirmation_required",
          message: textOut ||
            `I have prepared "${pendingConfirmation.tool_name}". Review the details and confirm to run it.`,
          confirmation: pendingConfirmation,
          data: structured,
        });
      }
    }

    return json({
      type: "answer",
      message: "I gathered the data but could not finish the summary. Please try a narrower question.",
      data: structured,
    });
  } catch (e) {
    console.error("[nl-query] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
