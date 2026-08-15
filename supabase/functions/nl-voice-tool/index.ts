import { createClient } from "npm:@supabase/supabase-js@2";
import { executeTool, TOOL_KIND, toolSchemas, type ToolName } from "../_shared/nlTools.ts";
import { verifySession } from "../_shared/voiceSession.ts";
import {
  type AssistantAuditEntry,
  logAssistantAudit,
  resolvePersona,
} from "../_shared/assistantScope.ts";

type AssistantOutcome = AssistantAuditEntry["outcome"];

// The signed voice session only carries { userId, companyId } — roles are not
// embedded in the token, so we fetch them fresh on every tool call. This is
// the sole enforcement point for the voice channel (no JWT/RLS is available
// here, everything runs under the service-role key), so this fetch is not
// optional: without it every write/read tool would fall through the
// `roles` checks in nlTools.ts/ownership.ts as if the caller had no roles.

/**
 * Vapi tool webhook for the voice operations assistant.
 *
 * This is the ONLY place voice tool calls are executed, and it runs the exact
 * same path as the text assistant: shared Zod schemas, shared executeTool()
 * (company scoping + PII allow-list) and the same nl_audit_log rows. There is
 * no voice-specific business logic.
 *
 * Auth: the caller is Vapi, not the operator, so there is no user JWT. The
 * session token in the query string is HMAC-signed by nl-voice-session after
 * verifying the operator's JWT, and carries the { userId, companyId } scope.
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

interface VapiToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

const parseArgs = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const session = await verifySession(new URL(req.url).searchParams.get("s"));
    if (!session) return json({ error: "Invalid or expired voice session" }, 401);

    const { uid: userId, cid: companyId, sid: sessionId } = session;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
    const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    // Email is looked up server-side from the session's user id (never sent by
    // Vapi) and is only used to resolve client-portal users to their own record.
    const { data: authUser } = await db.auth.admin.getUserById(userId);
    const email = authUser?.user?.email ?? null;
    const ctx = { db, userId, companyId, roles, email };
    const persona = resolvePersona(roles);

    const OUTCOME: Record<string, AssistantOutcome> = {
      executed: "success",
      confirmation_required: "success",
      invalid_args: "invalid_input",
      rejected: "rejected",
      error: "error",
      cancelled: "rejected",
    };

    const audit = async (
      tool: string,
      args: unknown,
      result: Record<string, unknown> | null,
      status: string,
      resource?: {
        resource_type?: string;
        resource_id?: string | null;
        access_granted?: boolean;
        rows?: unknown[];
      },
    ) => {
      await db.from("nl_audit_log").insert({
        user_id: userId,
        company_id: companyId,
        tool_name: tool,
        args: args ?? {},
        result: { ...(result ?? {}), session_id: sessionId, channel: "voice" },
        status,
        resource_type: resource?.resource_type ?? null,
        resource_id: resource?.resource_id ?? null,
        access_granted: resource?.access_granted ?? null,
      });
      const denied = resource?.access_granted === false;
      await logAssistantAudit(db, {
        userId,
        companyId,
        role: persona,
        toolName: tool,
        args,
        resultCount: Array.isArray(resource?.rows) ? resource!.rows!.length : null,
        outcome: denied ? "access_denied" : (OUTCOME[status] ?? "error"),
        errorCode: status === "executed" ? null : status,
        channel: "voice",
        sessionId,
      });
    };

    const body = await req.json().catch(() => ({}));
    const message = body?.message ?? body;
    const calls: VapiToolCall[] = message?.toolCalls ?? message?.toolCallList ?? [];
    if (!Array.isArray(calls) || calls.length === 0) return json({ results: [] });

    const results: Array<{ toolCallId: string; result: string }> = [];

    for (const call of calls) {
      const toolCallId = String(call.id ?? "");
      const name = String(call.function?.name ?? "");
      const args = parseArgs(call.function?.arguments);

      // ---- spoken confirmation of a queued write -----------------------
      if (name === "confirm_pending_action") {
        const { data: rows } = await db.from("nl_audit_log")
          .select("id, tool_name, args, result, status, created_at")
          .eq("user_id", userId)
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(30);

        const mine = (rows ?? []).filter((r) =>
          (r.result as { session_id?: string } | null)?.session_id === sessionId
        );
        const resolvedPendingIds = new Set(
          (rows ?? [])
            .filter((r) => ["executed", "cancelled", "error", "invalid_args"].includes(r.status))
            .map((r) => (r.result as { pending_id?: string } | null)?.pending_id)
            .filter((id): id is string => Boolean(id)),
        );
        const pending = mine.find((r) =>
          r.status === "confirmation_required" && !resolvedPendingIds.has(r.id)
        );

        console.log("[nl-voice-tool] confirm pending trace", JSON.stringify({
          sessionId,
          confirm: args.confirm === true,
          pendingId: pending?.id ?? null,
          sessionPendingIds: mine.filter((r) => r.status === "confirmation_required").map((r) => r.id),
          resolvedPendingIds: [...resolvedPendingIds],
        }));

        if (!pending) {
          results.push({ toolCallId, result: "There is no action waiting for confirmation." });
          continue;
        }

        // Atomically claim the source pending row before executing/cancelling.
        // A concurrent poll or duplicate confirm can no longer discover it.
        const { data: claimed, error: claimError } = await db.from("nl_audit_log")
          .update({
            status: "resolving",
            result: {
              session_id: sessionId,
              channel: "voice",
              pending_id: pending.id,
              requested_confirmation: args.confirm === true,
            },
          })
          .eq("id", pending.id)
          .eq("status", "confirmation_required")
          .select("id")
          .maybeSingle();
        if (claimError || !claimed) {
          console.log("[nl-voice-tool] pending claim lost", JSON.stringify({
            sessionId,
            pendingId: pending.id,
            error: claimError?.message ?? null,
          }));
          results.push({ toolCallId, result: "That action has already been answered." });
          continue;
        }

        if (args.confirm !== true) {
          await audit(pending.tool_name, pending.args, { cancelled_by: "voice", pending_id: pending.id }, "cancelled");
          results.push({ toolCallId, result: "Discarded. Nothing was changed." });
          continue;
        }

        const toolName = pending.tool_name as ToolName;
        const parsed = toolSchemas[toolName]?.safeParse(pending.args ?? {});
        if (!parsed?.success) {
          await audit(toolName, pending.args, { error: "invalid_args", pending_id: pending.id }, "invalid_args");
          results.push({ toolCallId, result: "Those details are no longer valid. Please start again." });
          continue;
        }
        try {
          const out = await executeTool(toolName, parsed.data, ctx);
          await audit(toolName, parsed.data, { summary: out.summary, rows: out.rows.slice(0, 25), pending_id: pending.id }, "executed", out);
          results.push({ toolCallId, result: out.summary });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Execution failed";
          await audit(toolName, parsed.data, { error: msg, pending_id: pending.id }, "error");
          results.push({ toolCallId, result: `That failed: ${msg}` });
        }
        continue;
      }

      // ---- whitelisted tools -------------------------------------------
      if (!(name in toolSchemas)) {
        await audit(name || "unknown", args, { error: "not_whitelisted" }, "rejected");
        results.push({ toolCallId, result: "That tool does not exist. Tell the operator you cannot do that." });
        continue;
      }

      const toolName = name as ToolName;
      const parsed = toolSchemas[toolName].safeParse(args);
      if (!parsed.success) {
        await audit(toolName, args, { error: parsed.error.issues }, "invalid_args");
        results.push({
          toolCallId,
          result: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        });
        continue;
      }

      if (TOOL_KIND[toolName] === "write") {
        const { data: recentRows } = await db.from("nl_audit_log")
          .select("id, tool_name, args, result, status")
          .eq("user_id", userId)
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(60);
        const sessionRows = (recentRows ?? []).filter((row) =>
          (row.result as { session_id?: string } | null)?.session_id === sessionId
        );
        const resolvedIds = new Set(
          sessionRows
            .filter((row) => ["executed", "cancelled", "error", "invalid_args"].includes(row.status))
            .map((row) => (row.result as { pending_id?: string } | null)?.pending_id)
            .filter((id): id is string => Boolean(id)),
        );
        const existingPending = sessionRows.find((row) =>
          row.status === "confirmation_required" && !resolvedIds.has(row.id)
        );
        if (existingPending) {
          console.log("[nl-voice-tool] duplicate pending suppressed", JSON.stringify({
            sessionId,
            requestedTool: toolName,
            existingPendingId: existingPending.id,
            existingTool: existingPending.tool_name,
          }));
          results.push({
            toolCallId,
            result: "Another action is already waiting for your spoken confirmation. Ask for yes or no and call confirm_pending_action before preparing anything else.",
          });
          continue;
        }
        await audit(toolName, parsed.data, { status: "awaiting_confirmation" }, "confirmation_required");
        results.push({
          toolCallId,
          result:
            "Prepared but NOT executed. Read the details back and ask the operator to confirm out loud, then call confirm_pending_action.",
        });
        continue;
      }

      try {
        const out = await executeTool(toolName, parsed.data, ctx);
        await audit(toolName, parsed.data, { summary: out.summary, rows: out.rows.slice(0, 25) }, "executed", out);
        results.push({
          toolCallId,
          result: JSON.stringify({ summary: out.summary, rows: out.rows.slice(0, 10) }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Tool failed";
        await audit(toolName, parsed.data, { error: msg }, "error");
        results.push({ toolCallId, result: `That failed: ${msg}` });
      }
    }

    return json({ results });
  } catch (e) {
    console.error("[nl-voice-tool] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
