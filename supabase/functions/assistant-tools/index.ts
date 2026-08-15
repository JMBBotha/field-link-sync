// FieldLink Sync – Assistant Tools
// Direct HTTP endpoint for voice assistant tools.
// Supports: search_customers, search_items, create_estimate, confirm_pending_action
//
// Adapted to the existing project schema:
//   - company_id (not organisation_id)
//   - customers, supplier_products, quotes, quote_line_items
//   - assistant_audit_logs (not audit_events)
//   - user_roles / profiles for identity and RBAC
//
// Identity is derived strictly from the Supabase JWT. No user_id, role,
// company_id or client_id sent in the body is trusted.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  logAssistantAudit,
  resolvePersona,
  resolveScope,
  sanitizeArgs,
  type AssistantAuditEntry,
} from "../_shared/assistantScope.ts";
import { OPS_ROLES } from "../_shared/recordAccess.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const DEFAULT_VAT_RATE = 0.15;

// ========== ZOD SCHEMAS ==========
// No scoping fields are accepted from the caller.
const SearchParamsSchema = z.object({
  query: z.string().trim().optional().default(""),
  limit: z.number().int().min(1).max(25).optional().default(8),
});

const LineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unit_price: z.number().nonnegative(),
  unit: z.string().optional().default("each"),
});

const CreateEstimateParamsSchema = z.object({
  customer_id: z.string().uuid().optional(),
  customer_name: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(300).optional(),
  line_items: z.array(LineItemSchema).min(1).max(50).optional(),
  notes: z.string().max(2000).optional(),
  valid_until_days: z.number().int().min(1).max(90).optional().default(14),
  confirm: z.boolean().optional().default(false),
  pending_id: z.string().uuid().optional(),
});

const ConfirmPendingActionSchema = z.object({
  pending_id: z.string().uuid(),
  confirm: z.literal(true),
});

// ========== TYPES ==========
type ToolName =
  | "search_customers"
  | "search_items"
  | "create_estimate"
  | "confirm_pending_action";

interface CallerContext {
  userId: string;
  companyId: string;
  roles: string[];
  email: string | null;
  fullName: string;
}

// ========== MAIN HANDLER ==========
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const started = Date.now();
  const reqMeta = {
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: req.headers.get("user-agent") || null,
    request_id: req.headers.get("x-request-id") || crypto.randomUUID(),
  };

  let toolName: ToolName | "unknown" = "unknown";
  let rawArgs: Record<string, unknown> = {};
  let outcome: AssistantAuditEntry["outcome"] = "success";
  let errorCode: string | null = null;
  let resultCount: number | null = null;
  let resourceType: string | null = null;
  let resourceId: string | null = null;
  let member: CallerContext | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    // Verify JWT with the anon key; identity comes ONLY from the token.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired token" }, 401);
    }
    const userId = userData.user.id;
    const email = userData.user.email ?? null;

    // Service-role client for all DB operations; scope is enforced in code.
    const db = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Resolve company and roles.
    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("company_id, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr || !profile?.company_id) {
      return jsonResponse({ error: "No active company linked to this account" }, 403);
    }
    const companyId: string = profile.company_id;

    const { data: roleRows, error: rolesErr } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) throw rolesErr;
    const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);

    member = {
      userId,
      companyId,
      roles,
      email,
      fullName: profile.full_name ?? "team member",
    };

    const body = await req.json().catch(() => ({}));
    const tool = String(body.tool ?? "") as ToolName;
    rawArgs = body.parameters ?? {};

    if (!tool) {
      outcome = "invalid_input";
      errorCode = "missing_tool";
      return jsonResponse({ error: "tool is required" }, 400);
    }
    toolName = tool;

    let result: unknown = null;

    switch (tool) {
      case "search_customers": {
        const params = SearchParamsSchema.parse(rawArgs);
        result = await searchCustomers(db, member, params.query, params.limit);
        resultCount = Array.isArray(result) ? result.length : null;
        resourceType = "customer";
        break;
      }
      case "search_items": {
        const params = SearchParamsSchema.parse(rawArgs);
        result = await searchItems(db, member, params.query, params.limit);
        resultCount = Array.isArray(result) ? result.length : null;
        resourceType = "item";
        break;
      }
      case "create_estimate": {
        if (!canCreateQuote(member.roles)) {
          outcome = "access_denied";
          errorCode = "role_not_allowed";
          throw new Error("Your role is not allowed to create estimates");
        }
        const params = CreateEstimateParamsSchema.parse(rawArgs);
        const created = await createEstimate(db, member, params);
        result = created;
        resultCount = null;
        resourceType = "quote";
        resourceId = created.id ?? created.pending_id ?? null;
        break;
      }
      case "confirm_pending_action": {
        if (!canCreateQuote(member.roles)) {
          outcome = "access_denied";
          errorCode = "role_not_allowed";
          throw new Error("Your role is not allowed to confirm estimates");
        }
        const params = ConfirmPendingActionSchema.parse(rawArgs);
        const confirmed = await confirmPendingEstimate(db, member, params.pending_id);
        result = confirmed;
        resourceType = "quote";
        resourceId = confirmed.id ?? null;
        break;
      }
      default:
        outcome = "invalid_input";
        errorCode = "unsupported_tool";
        return jsonResponse({ error: `Unsupported tool: ${tool}` }, 400);
    }

    await logAssistantAudit(db, {
      userId: member.userId,
      companyId: member.companyId,
      role: resolvePersona(member.roles),
      toolName: toolName === "unknown" ? "unknown" : toolName,
      args: sanitizeArgs(rawArgs),
      resultCount,
      outcome,
      errorCode,
      channel: "voice",
      sessionId: reqMeta.request_id,
    });

    return jsonResponse({
      success: true,
      tool: toolName,
      data: result,
      meta: {
        company_id: member.companyId,
        role: resolvePersona(member.roles),
        request_id: reqMeta.request_id,
      },
    });
  } catch (err: any) {
    console.error("assistant-tools error:", err);
    const status = outcome === "access_denied" ? 403 : outcome === "invalid_input" ? 400 : 500;
    const message = status === 500 ? "Internal server error" : (err?.message ?? "Tool execution failed");

    if (member) {
      try {
        const fallbackDb = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } },
        );
        await logAssistantAudit(fallbackDb, {
          userId: member.userId,
          companyId: member.companyId,
          role: resolvePersona(member.roles),
          toolName: toolName === "unknown" ? "unknown" : toolName,
          args: sanitizeArgs(rawArgs),
          resultCount,
          outcome: outcome === "success" ? "error" : outcome,
          errorCode: errorCode ?? err?.message?.slice(0, 120) ?? null,
          channel: "voice",
          sessionId: reqMeta.request_id,
        });
      } catch (auditErr) {
        console.error("assistant-tools audit error:", auditErr);
      }
    }

    return jsonResponse({ error: message }, status);
  } finally {
    console.log(`[assistant-tools] ${reqMeta.request_id} ${toolName} ${Date.now() - started}ms`);
  }
}

serve(handleRequest);

// ========== HELPERS ==========
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function canCreateQuote(roles: string[]): boolean {
  const allowed = new Set(["admin", "dispatcher", "platform_super_admin", "platform_ops", "sales", "estimator"]);
  return roles.some((r) => allowed.has(r));
}

function nameTokens(input: string): string[] {
  return input
    .replace(/[%,()]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

async function searchCustomers(
  db: any,
  member: CallerContext,
  query: string,
  limit: number,
) {
  const scope = await resolveScope(db, member.userId, member.companyId, member.roles, member.email);
  if (scope.customerIds && scope.customerIds.size === 0) {
    return [];
  }

  const raw = String(query ?? "").trim();
  const tokens = nameTokens(raw);
  const fields = ["first_name", "last_name", "company_name", "phone", "email"];
  const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")].filter(Boolean);
  const orFilter = patterns.flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`)).join(",");

  let q = db
    .from("customers")
    .select("id, first_name, last_name, company_name, phone, email, city, status")
    .eq("company_id", member.companyId)
    .order("last_name", { ascending: true })
    .limit(Math.min(limit, 25));

  if (orFilter) q = q.or(orFilter);
  if (scope.customerIds) q = q.in("id", [...scope.customerIds]);

  const { data, error } = await q;
  if (error) throw error;

  return ((data ?? []) as Record<string, any>[]).map((c) => ({
    id: c.id,
    display_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Unnamed",
    company_name: c.company_name,
    phone: c.phone,
    email: c.email,
    city: c.city,
    status: c.status,
  }));
}

async function searchItems(
  db: any,
  member: CallerContext,
  query: string,
  limit: number,
) {
  const scope = await resolveScope(db, member.userId, member.companyId, member.roles, member.email);
  if (!scope.canSeeInventory) {
    return [];
  }

  const raw = String(query ?? "").trim();
  const tokens = nameTokens(raw);
  const fields = ["name", "short_name", "description", "model", "product_code", "brand", "category"];
  const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")].filter(Boolean);
  const orFilter = patterns.flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`)).join(",");

  let q = db
    .from("supplier_products")
    .select(
      "id, name, short_name, category, subcategory, brand, model, product_code, selling_price, sell_price_incl_vat, unit_type, is_price_on_request",
    )
    .eq("company_id", member.companyId)
    .eq("is_active", true)
    .or("archived.is.false,archived.is.null")
    .order("name", { ascending: true })
    .limit(Math.min(limit, 25));

  if (orFilter) q = q.or(orFilter);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []) as Record<string, any>[];
}

async function createEstimate(db: any, member: CallerContext, params: any) {
  // If the caller passed a pending_id and confirm, just confirm it.
  if (params.confirm && params.pending_id) {
    return confirmPendingEstimate(db, member, params.pending_id);
  }

  let customerId = params.customer_id;
  let customerName = params.customer_name;
  let customerDisplayName = "";

  if (!customerId && customerName) {
    const { data: matches } = await db
      .from("customers")
      .select("id, first_name, last_name, company_name")
      .eq("company_id", member.companyId)
      .ilike("first_name", `%${customerName}%`)
      .or(`last_name.ilike.%${customerName}%,company_name.ilike.%${customerName}%`)
      .limit(5);

    if (!matches || matches.length === 0) {
      throw new Error(`No customer found matching "${customerName}". Please search_customers first.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple customers match "${customerName}". Please provide the exact customer_id.`);
    }
    customerId = matches[0].id;
    customerDisplayName = [matches[0].first_name, matches[0].last_name]
      .filter(Boolean)
      .join(" ") || matches[0].company_name || "Unnamed";
  }

  if (!customerId) {
    throw new Error("customer_id or customer_name is required");
  }

  const { data: customer, error: custErr } = await db
    .from("customers")
    .select("id, first_name, last_name, company_name")
    .eq("id", customerId)
    .eq("company_id", member.companyId)
    .single();

  if (custErr || !customer) {
    throw new Error("Customer not found in your company");
  }

  customerDisplayName = customerDisplayName ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    customer.company_name || "Unnamed";

  if (!params.line_items || params.line_items.length === 0) {
    throw new Error("At least one line_item is required");
  }

  const lineItems = params.line_items.map((li: any) => {
    const total = Math.round(li.quantity * li.unit_price * 100) / 100;
    return {
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      unit: li.unit ?? "each",
      total,
    };
  });

  const subtotal = Number(lineItems.reduce((s: number, li: any) => s + li.total, 0).toFixed(2));
  const taxRate = DEFAULT_VAT_RATE;
  const taxAmount = Number((subtotal * taxRate).toFixed(2));
  const total = Number((subtotal + taxAmount).toFixed(2));

  const title = params.title || `Estimate for ${customerDisplayName}`;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (params.valid_until_days ?? 14));

  const { data: draft, error: insertErr } = await db
    .from("quotes")
    .insert({
      company_id: member.companyId,
      customer_id: customerId,
      customer_name: customerDisplayName,
      sales_engineer_id: member.userId,
      status: "draft",
      title,
      subtotal,
      vat_rate: taxRate,
      vat_amount: taxAmount,
      total,
      notes: params.notes ?? null,
      valid_until: validUntil.toISOString().slice(0, 10),
    })
    .select("id, quote_number, status, total, valid_until")
    .single();

  if (insertErr) throw new Error(insertErr.message);

  // Insert line items into the existing quote_line_items table.
  const quoteLineItems = lineItems.map((li: any) => ({
    quote_id: draft.id,
    description: li.description,
    quantity: li.quantity,
    unit_price: li.unit_price,
    total: li.total,
  }));

  const { error: linesErr } = await db.from("quote_line_items").insert(quoteLineItems);
  if (linesErr) throw new Error(linesErr.message);

  return {
    confirmed: false,
    pending_id: draft.id,
    quote_number: draft.quote_number,
    message: "Estimate created as a draft. Read the summary and ask the user to confirm.",
    summary: {
      customer: customerDisplayName,
      title,
      line_items: lineItems.map((li: any) =>
        `${li.quantity} × ${li.description} @ R${li.unit_price.toFixed(2)}`
      ),
      subtotal: `R${subtotal.toFixed(2)}`,
      vat: `R${taxAmount.toFixed(2)}`,
      total: `R${total.toFixed(2)}`,
      valid_until: draft.valid_until,
    },
    next_step: "Call confirm_pending_action with this pending_id after the user says yes.",
  };
}

async function confirmPendingEstimate(db: any, member: CallerContext, pendingId: string) {
  const { data: draft, error } = await db
    .from("quotes")
    .select("id, quote_number, company_id, sales_engineer_id, status, total, title, customer_name")
    .eq("id", pendingId)
    .eq("company_id", member.companyId)
    .single();

  if (error || !draft) {
    throw new Error("Pending estimate not found");
  }

  // Only ops or the creator may confirm the draft.
  const isOps = member.roles.some((r) => OPS_ROLES.has(r));
  if (!isOps && draft.sales_engineer_id !== member.userId) {
    throw new Error("You don't have access to that estimate");
  }

  if (draft.status !== "draft") {
    throw new Error(`Estimate is already ${draft.status}`);
  }

  const { data: finalised, error: updateErr } = await db
    .from("quotes")
    .update({
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", pendingId)
    .select("id, quote_number, title, total, status, customer_name")
    .single();

  if (updateErr) throw new Error(updateErr.message);

  return {
    confirmed: true,
    id: finalised.id,
    quote_number: finalised.quote_number,
    title: finalised.title,
    customer: finalised.customer_name,
    total: finalised.total,
    status: finalised.status,
    message: `Estimate ${finalised.quote_number} has been confirmed and sent.`,
  };
}
