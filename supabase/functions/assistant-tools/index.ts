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

// `confirm` may be false (the user said no / cancel) and `pending_id` may be
// omitted — in that case we resolve the caller's most recent pending draft.
const ConfirmPendingActionSchema = z.object({
  pending_id: z.string().uuid().optional(),
  confirm: z.boolean().default(true),
});

// ========== TYPES ==========
type ToolName =
  | "search_customers"
  | "search_items"
  | "create_estimate"
  | "confirm_pending_action";

interface ToolResult {
  id?: string;
  pending_id?: string;
  [key: string]: unknown;
}

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
        const pendingId = params.pending_id ?? await latestPendingEstimateId(db, member);
        const confirmed = params.confirm
          ? await confirmPendingEstimate(db, member, pendingId)
          : await cancelPendingEstimate(db, member, pendingId);
        result = confirmed;
        resourceType = "quote";
        resourceId = (confirmed.id as string | undefined) ?? null;
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
      toolName: toolName,
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

// ---------- Product search intelligence ----------

const BTU_PER_KW = 3412;
const BTU_TOLERANCE = 0.15;

/** Columns that actually carry product info in this catalogue. */
const PRODUCT_TEXT_FIELDS = [
  "product_code",
  "short_name",
  "description",
  "brand",
  "category",
] as const;

const PRODUCT_SELECT =
  "id, name, short_name, description, category, subcategory, brand, model, product_code, " +
  "selling_price, sell_price_incl_vat, is_price_on_request, unit_type, btu_rating, kw";

/** Words that add noise rather than signal in a spoken query. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "for", "with", "unit", "units", "aircon", "air",
  "con", "conditioner", "please", "find", "show", "me", "some", "any", "of",
  "btu", "btus", "kw", "kilowatt", "kilowatts", "watt", "watts",
]);

/**
 * Extract a target BTU capacity from free text.
 * Handles: "9000", "9000 btu", "9k", "2.6kw", "2,6 kw", "AR09", "AR14".
 */
function parseCapacity(raw: string): number | null {
  const text = raw.toLowerCase();

  // kW first — "2.6kw", "2,6 kw", "3.5 kilowatt"
  const kwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kw|kilowatts?)\b/);
  if (kwMatch) {
    const kw = parseFloat(kwMatch[1].replace(",", "."));
    if (kw > 0 && kw < 100) return Math.round(kw * BTU_PER_KW);
  }

  // Explicit BTU — "9000 btu", "12 000btu"
  const btuMatch = text.match(/(\d{4,6})\s*btus?\b/);
  if (btuMatch) return parseInt(btuMatch[1], 10);

  // Shorthand "9k", "12k", "24 k"
  const kMatch = text.match(/\b(\d{1,3})\s*k\b/);
  if (kMatch) {
    const n = parseInt(kMatch[1], 10);
    if (n >= 5 && n <= 100) return n * 1000;
  }

  // Bare 4-6 digit number that looks like a BTU rating
  const bare = text.match(/\b(\d{4,6})\b/);
  if (bare) {
    const n = parseInt(bare[1], 10);
    if (n >= 5000 && n <= 120000) return n;
  }

  return null;
}

/**
 * Capacity encoded inside a model code, e.g. "AR09BSHGAWK/FA" -> 9000,
 * "AR14" -> 14000, or a short name like "Samsung 24K INV MW" -> 24000.
 */
function capacityFromCode(...values: (string | null | undefined)[]): number | null {
  for (const v of values) {
    if (!v) continue;
    const s = v.toLowerCase();

    const kShort = s.match(/\b(\d{1,3})\s*k\b/);
    if (kShort) {
      const n = parseInt(kShort[1], 10);
      if (n >= 5 && n <= 100) return n * 1000;
    }

    // Leading letters followed by 2 digits: AR09, AR14, MSZ18...
    const codeNum = s.match(/[a-z]{2,4}[-\s]?(\d{2})(?![0-9])/);
    if (codeNum) {
      const n = parseInt(codeNum[1], 10);
      if (n >= 5 && n <= 60) return n * 1000;
    }
  }
  return null;
}

function withinTolerance(target: number, actual: number): boolean {
  return actual >= target * (1 - BTU_TOLERANCE) && actual <= target * (1 + BTU_TOLERANCE);
}

/** Tokens worth matching as text (capacity terms and filler removed). */
function productTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[%,()"']/g, " ")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:kw|kilowatts?)\b/g, " ")
    .replace(/(\d{4,6})\s*btus?\b/g, " ")
    .replace(/\b\d{4,6}\b/g, " ")
    .replace(/\b\d{1,3}\s*k\b/g, " ")
    .split(/[\s/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function productBlob(row: Record<string, any>): string {
  return PRODUCT_TEXT_FIELDS.map((f) => row[f] ?? "")
    .concat(row.subcategory ?? "", row.short_name ?? "")
    .join(" ")
    .toLowerCase();
}

/**
 * Score a candidate row: text-token hits (weighted by field priority)
 * plus a capacity bonus when the requested BTU matches.
 */
function scoreProduct(
  row: Record<string, any>,
  tokens: string[],
  targetBtu: number | null,
): { score: number; matchedTokens: number; capacityOk: boolean } {
  const fieldWeights: Record<string, number> = {
    product_code: 5,
    short_name: 4,
    brand: 3,
    description: 2,
    category: 1,
  };

  let score = 0;
  let matchedTokens = 0;

  for (const token of tokens) {
    let best = 0;
    for (const field of PRODUCT_TEXT_FIELDS) {
      const value = String(row[field] ?? "").toLowerCase();
      if (!value) continue;
      if (value.includes(token)) {
        const exactWord = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`).test(value);
        best = Math.max(best, fieldWeights[field] * (exactWord ? 1.5 : 1));
      }
    }
    if (best > 0) {
      matchedTokens++;
      score += best;
    }
  }

  let capacityOk = false;
  if (targetBtu != null) {
    const numeric = typeof row.btu_rating === "number" ? row.btu_rating : null;
    const fromKw = row.kw ? Math.round(Number(row.kw) * BTU_PER_KW) : null;
    const fromText = capacityFromCode(row.product_code, row.short_name, row.description);
    const candidates = [numeric, fromKw, fromText].filter((n): n is number => !!n);

    if (candidates.some((c) => withinTolerance(targetBtu, c))) {
      capacityOk = true;
      // Exact numeric column match ranks highest.
      score += numeric != null && withinTolerance(targetBtu, numeric) ? 12 : 8;
    }
  }

  return { score, matchedTokens, capacityOk };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProductOrFilter(tokens: string[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    const escaped = token.replace(/[%_,]/g, " ").trim();
    if (!escaped) continue;
    for (const field of PRODUCT_TEXT_FIELDS) {
      parts.push(`${field}.ilike.%${escaped}%`);
    }
  }
  return parts.join(",");
}

function shapeProduct(row: Record<string, any>) {
  const capacity = typeof row.btu_rating === "number"
    ? row.btu_rating
    : capacityFromCode(row.product_code, row.short_name);

  return {
    id: row.id,
    // Most rows have a null `name`; fall back so the agent never sees a blank label.
    name: row.name ?? row.short_name ?? row.product_code ?? "Unnamed product",
    short_name: row.short_name,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    model: row.model ?? row.product_code,
    product_code: row.product_code,
    selling_price: row.selling_price,
    sell_price_incl_vat: row.sell_price_incl_vat,
    is_price_on_request: row.is_price_on_request,
    unit_type: row.unit_type,
    btu_rating: capacity,
    kw: row.kw,
  };
}

async function searchItems(
  db: any,
  member: CallerContext,
  query: string,
  limit: number,
) {
  const scope = await resolveScope(db, member.userId, member.companyId, member.roles, member.email);
  if (!scope.canSeeInventory) {
    return {
      rows: [],
      summary: "No inventory available for this account.",
      access_granted: false,
    };
  }

  const raw = String(query ?? "").trim();
  const targetBtu = parseCapacity(raw);
  const tokens = productTokens(raw);
  const cap = Math.min(limit, 25);

  const base = () =>
    db
      .from("supplier_products")
      .select(PRODUCT_SELECT)
      .eq("is_active", true)
      .or("archived.is.false,archived.is.null");

  // Pull a wide candidate pool, then rank in code so partial/extra/missing
  // words and capacity variations all still surface the right products.
  let q = base().limit(400);

  const orFilter = buildProductOrFilter(tokens);
  if (orFilter) q = q.or(orFilter);

  if (targetBtu != null) {
    const lo = Math.floor(targetBtu * (1 - BTU_TOLERANCE));
    const hi = Math.ceil(targetBtu * (1 + BTU_TOLERANCE));
    // Widen the pool with anything in the capacity band, even if no word matched.
    const { data: byCapacity } = await base()
      .gte("btu_rating", lo)
      .lte("btu_rating", hi)
      .limit(200);

    const { data: byText, error } = await q;
    if (error) throw error;

    const merged = new Map<string, Record<string, any>>();
    for (const row of [...(byText ?? []), ...(byCapacity ?? [])]) merged.set(row.id, row);
    return rankProducts([...merged.values()], tokens, targetBtu, cap);
  }

  const { data, error } = await q;
  if (error) throw error;

  let pool = (data ?? []) as Record<string, any>[];

  // Nothing matched the tokens — fall back to a general recent slice so the
  // agent can still offer options rather than claiming the catalogue is empty.
  if (pool.length === 0 && tokens.length > 0) {
    const { data: fallback } = await base()
      .order("quote_usage_count", { ascending: false, nullsFirst: false })
      .limit(cap);
    pool = (fallback ?? []) as Record<string, any>[];
  }

  return rankProducts(pool, tokens, targetBtu, cap);
}

function rankProducts(
  pool: Record<string, any>[],
  tokens: string[],
  targetBtu: number | null,
  cap: number,
) {
  const scored = pool.map((row) => ({ row, ...scoreProduct(row, tokens, targetBtu) }));

  // Prefer rows that satisfy the capacity request AND matched at least one word.
  const strict = scored.filter((s) =>
    (targetBtu == null || s.capacityOk) && (tokens.length === 0 || s.matchedTokens > 0)
  );
  const relaxed = scored.filter((s) => s.score > 0);

  const chosen = strict.length > 0 ? strict : (relaxed.length > 0 ? relaxed : scored);

  return chosen
    .sort((a, b) =>
      b.score - a.score ||
      b.matchedTokens - a.matchedTokens ||
      String(a.row.short_name ?? a.row.product_code ?? "").localeCompare(
        String(b.row.short_name ?? b.row.product_code ?? ""),
      )
    )
    .slice(0, cap)
    .map((s) => shapeProduct(s.row));
}

async function createEstimate(db: any, member: CallerContext, params: any): Promise<ToolResult> {
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

async function confirmPendingEstimate(db: any, member: CallerContext, pendingId: string): Promise<ToolResult> {
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
