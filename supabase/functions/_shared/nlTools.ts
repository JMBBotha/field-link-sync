import { z } from "npm:zod@3.23.8";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hasRecordAccess } from "./recordAccess.ts";
import { resolveCandidates, type EntityCandidate } from "./entityResolution.ts";
import { getOwnedScope, isOpsRole } from "./ownership.ts";
import { resolveScope } from "./assistantScope.ts";

const DEFAULT_VAT_RATE = 0.15; // South Africa standard rate, used only when a quote/invoice row has none set.

/** ---------------------------------------------------------------
 *  Whitelisted tool registry for the natural-language interface.
 *  No free-form SQL is ever accepted: every tool maps to a fixed,
 *  parameterised PostgREST query, and every result is filtered
 *  through a PII allow-list before it leaves this module.
 *  --------------------------------------------------------------- */

export type ToolKind = "read" | "write";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.string().uuid();

export const toolSchemas = {
  query_leads: z.object({
    status: z.string().max(40).nullable().optional(),
    priority: z.enum(["emergency", "same_day", "standard"]).nullable().optional(),
    date_from: isoDate.nullable().optional(),
    date_to: isoDate.nullable().optional(),
    location: z.string().max(120).nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  get_overdue_invoices: z.object({
    location: z.string().max(120).nullable().optional(),
    days_overdue: z.number().int().min(0).max(3650).nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  query_jobs: z.object({
    status: z.string().max(40).nullable().optional(),
    staff_id: uuid.nullable().optional(),
    date_from: isoDate.nullable().optional(),
    date_to: isoDate.nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  search_customer: z.object({
    query: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(25).nullable().optional(),
  }),
  get_staff_availability: z.object({
    status: z.enum(["available", "busy", "offline"]).nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  get_unassigned_queue: z.object({
    only_unresolved: z.boolean().nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
  }),
  get_quote: z.object({
    identifier: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(10).nullable().optional(),
  }),
  get_invoice: z.object({
    identifier: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(10).nullable().optional(),
  }),
  create_quote_draft: z.object({
    lead_id: uuid,
    notes: z.string().max(500).nullable().optional(),
  }),
  assign_job: z.object({
    job_id: uuid,
    staff_id: uuid,
  }),
  resolve_entity: z.object({
    entity_type: z.enum(["customer", "lead", "job", "quote", "product", "staff", "all"]),
    query: z.string().min(2).max(160),
    for_action: z.enum(["read", "write"]).nullable().optional(),
    limit: z.number().int().min(1).max(5).nullable().optional(),
  }),
  search_products: z.object({
    query: z.string().min(2).max(120),
    category: z.string().max(60).nullable().optional(),
    limit: z.number().int().min(1).max(25).nullable().optional(),
  }),
  add_quote_item: z.object({
    quote_id: uuid,
    product_id: uuid.nullable().optional(),
    description: z.string().min(2).max(200).nullable().optional(),
    quantity: z.number().positive().max(9999).nullable().optional(),
    unit_price: z.number().nonnegative().max(10_000_000).nullable().optional(),
  }),
  accept_quote: z.object({
    quote_id: uuid,
  }),
  add_invoice_item: z.object({
    invoice_id: uuid,
    description: z.string().min(2).max(200),
    quantity: z.number().positive().max(9999).nullable().optional(),
    unit_price: z.number().nonnegative().max(10_000_000),
  }),
  create_invoice: z.object({
    customer_id: uuid,
    description: z.string().min(2).max(200),
    amount_excl_vat: z.number().nonnegative().max(10_000_000),
    lead_id: uuid.nullable().optional(),
  }),
  // --- secure read-only slice (server-authorized, no write side effects) ---
  // NOTE: these schemas deliberately accept NO user_id / organisation_id /
  // role / client_id / technician_id / scope fields. Identity comes only from
  // the verified JWT or signed voice session.
  search_customers: z.object({
    query: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(25).nullable().optional(),
    offset: z.number().int().min(0).max(500).nullable().optional(),
  }).strict(),
  get_customer_details: z.object({
    customer_id: uuid,
  }).strict(),
  search_inventory: z.object({
    query: z.string().min(2).max(120),
    category: z.string().max(60).nullable().optional(),
    in_stock_only: z.boolean().nullable().optional(),
    limit: z.number().int().min(1).max(25).nullable().optional(),
    offset: z.number().int().min(0).max(500).nullable().optional(),
  }).strict(),
  get_assigned_jobs: z.object({
    status: z.string().max(40).nullable().optional(),
    date_from: isoDate.nullable().optional(),
    date_to: isoDate.nullable().optional(),
    limit: z.number().int().min(1).max(50).nullable().optional(),
    offset: z.number().int().min(0).max(500).nullable().optional(),
  }).strict(),
} as const;


export type ToolName = keyof typeof toolSchemas;

export const TOOL_KIND: Record<ToolName, ToolKind> = {
  query_leads: "read",
  get_overdue_invoices: "read",
  query_jobs: "read",
  search_customer: "read",
  get_staff_availability: "read",
  get_unassigned_queue: "read",
  get_quote: "read",
  get_invoice: "read",
  create_quote_draft: "write",
  assign_job: "write",
  resolve_entity: "read",
  search_products: "read",
  add_quote_item: "write",
  accept_quote: "write",
  add_invoice_item: "write",
  create_invoice: "write",
  search_customers: "read",
  get_customer_details: "read",
  search_inventory: "read",
  get_assigned_jobs: "read",
};


/** PII allow-list: only these fields ever reach Claude or the browser. */
const PII_ALLOW: Record<ToolName, string[]> = {
  query_leads: [
    "id", "customer_name", "phone", "service_type", "status", "lead_status",
    "priority", "lead_priority", "primary_intent", "normalized_address", "city",
    "created_at", "scheduled_date", "assigned_agent_id", "technician_name",
  ],
  get_overdue_invoices: [
    "id", "invoice_number", "customer_name", "grand_total", "status",
    "due_date", "issue_date", "days_overdue", "customer_address",
  ],
  query_jobs: [
    "id", "title", "status", "priority", "job_type", "address",
    "scheduled_for", "created_at", "customer_id", "lead_id",
  ],
  search_customer: [
    "id", "first_name", "last_name", "company_name", "phone", "email",
    "primary_address_line1", "city", "status",
  ],
  get_staff_availability: [
    "id", "full_name", "availability_status", "dispatch_role", "dispatch_active",
    "skills", "max_travel_km",
  ],
  get_unassigned_queue: [
    "id", "lead_id", "reason", "priority", "escalate_at", "escalated",
    "resolved", "created_at",
  ],
  get_quote: [
    "id", "quote_number", "customer_name", "status", "total", "subtotal",
    "vat_amount", "valid_until", "created_at", "sent_at", "accepted_at",
    "lead_id", "customer_id",
  ],
  get_invoice: [
    "id", "invoice_number", "customer_name", "status", "grand_total", "subtotal",
    "tax_amount", "due_date", "issue_date", "paid_date", "created_at",
    "quote_id", "customer_id",
  ],
  create_quote_draft: ["id", "quote_number", "status", "customer_id", "lead_id", "total"],
  assign_job: ["id", "status", "title", "assigned_staff_id", "scheduled_for"],
  resolve_entity: ["entity_type", "id", "label", "sublabel", "reference", "score"],
  // Deliberately excludes cost_price / markup / supplier_discount_percent —
  // margin data is never surfaced through the assistant, for any role.
  search_products: [
    "id", "name", "short_name", "category", "subcategory", "brand", "model",
    "product_code", "selling_price", "sell_price_incl_vat", "price_includes_vat",
    "is_price_on_request", "unit_type", "capacity_btu", "kw",
  ],
  add_quote_item: ["id", "quote_id", "description", "quantity", "unit_price", "total", "quote_total"],
  accept_quote: ["id", "quote_number", "status", "accepted_at", "invoice_id", "invoice_number"],
  add_invoice_item: ["id", "invoice_id", "description", "quantity", "unit_price", "amount", "invoice_total"],
  create_invoice: ["id", "invoice_number", "status", "customer_id", "grand_total"],
  search_customers: [
    "id", "display_name", "company_name", "phone", "email", "city", "status",
  ],
  get_customer_details: [
    "id", "display_name", "company_name", "phone", "email",
    "primary_address_line1", "city", "postal_code", "status",
    "open_job_count", "recent_jobs", "quote_count", "last_job_at",
  ],
  // Never exposes unit_cost / supplier margin data.
  search_inventory: [
    "id", "name", "short_name", "category", "subcategory", "brand", "model",
    "product_code", "selling_price", "sell_price_incl_vat", "unit_type",
    "is_price_on_request", "quantity_on_hand", "in_stock",
  ],
  get_assigned_jobs: [
    "id", "title", "status", "priority", "job_type", "address",
    "scheduled_for", "customer_id", "customer_name",
  ],
};


function scrub(tool: ToolName, rows: Record<string, unknown>[]) {
  const allow = new Set(PII_ALLOW[tool]);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (allow.has(k)) out[k] = v;
    return out;
  });
}

/** Anthropic tool definitions (JSON Schema, mirrors the Zod schemas). */
export const anthropicTools = [
  {
    name: "query_leads",
    description: "List leads filtered by status, priority, creation date range or location (city / address text).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Lead status e.g. pending, accepted, completed" },
        priority: { type: "string", enum: ["emergency", "same_day", "standard"] },
        date_from: { type: "string", description: "YYYY-MM-DD, filters created_at >=" },
        date_to: { type: "string", description: "YYYY-MM-DD, filters created_at <=" },
        location: { type: "string", description: "City or address fragment" },
        limit: { type: "integer", description: "Max rows, default 20, max 50" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_overdue_invoices",
    description: "List unpaid invoices past their due date, optionally filtered by location and minimum days overdue.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City or address fragment" },
        days_overdue: { type: "integer", description: "Only invoices at least this many days overdue" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_jobs",
    description: "List jobs filtered by status, assigned staff member and scheduled date range.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        staff_id: { type: "string", description: "UUID of the assigned staff member" },
        date_from: { type: "string", description: "YYYY-MM-DD, filters scheduled_for >=" },
        date_to: { type: "string", description: "YYYY-MM-DD, filters scheduled_for <=" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_customer",
    description: "Search customers by name, company, phone or email.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, phone or email fragment" },
        limit: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_staff_availability",
    description: "List field staff with their availability status, dispatch role and skills.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["available", "busy", "offline"] },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_unassigned_queue",
    description: "List leads sitting in the unassigned/escalation queue.",
    input_schema: {
      type: "object",
      properties: {
        only_unresolved: { type: "boolean", description: "Default true" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_quote_draft",
    description: "Create a draft quote for a lead. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "UUID of the lead" },
        notes: { type: "string" },
      },
      required: ["lead_id"],
      additionalProperties: false,
    },
  },
  {
    name: "assign_job",
    description: "Assign a job to a staff member. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the job" },
        staff_id: { type: "string", description: "UUID of the staff member" },
      },
      required: ["job_id", "staff_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_quote",
    description:
      "Open / retrieve an existing quote (estimate) by quote number, client name or UUID. Returns only quotes the caller is permitted to see. If it returns no rows, tell the user you could not find that quote — never mention permissions or access.",
    input_schema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Quote number (e.g. Q-2026-0020), client name, or quote UUID" },
        limit: { type: "integer" },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
  },
  {
    name: "get_invoice",
    description:
      "Open / retrieve an existing invoice by invoice number, client name or UUID. Returns only invoices the caller is permitted to see. If it returns no rows, tell the user you could not find that invoice — never mention permissions or access.",
    input_schema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Invoice number, client name, or invoice UUID" },
        limit: { type: "integer" },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
  },
  {
    name: "resolve_entity",
    description:
      "Fuzzy-resolve a misheard, misspelled or partial name/number to real records " +
      "(customers, leads, jobs, quotes, products, staff). Use this FIRST whenever the " +
      "user refers to something by name and you are not certain of the exact record. " +
      "Returns up to 5 scored candidates plus a decision: 'auto' (safe to use the top " +
      "match), 'clarify' (read the options back and ask which one) or 'retry' (ask the " +
      "user to repeat or spell it). Never perform a write action on a 'clarify' or " +
      "'retry' result without explicit user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["customer", "lead", "job", "quote", "product", "staff", "all"],
          description: "Which kind of record to resolve",
        },
        query: { type: "string", description: "What the user said or typed, verbatim" },
        for_action: {
          type: "string",
          enum: ["read", "write"],
          description: "Use 'write' when the resolved record will be modified; this forces confirmation",
        },
        limit: { type: "integer", description: "Max candidates, default 5" },
      },
      required: ["entity_type", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_products",
    description: "Search the supplier product catalogue by name, brand, model or product code. Use this to find real items and their selling price when building a quote or invoice line. Never returns cost price or margin.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, brand, model or product code fragment" },
        category: { type: "string", description: "Optional category filter, e.g. 'split unit', 'ducting'" },
        limit: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "add_quote_item",
    description:
      "Add a line item to an existing draft quote/estimate, from a catalogue product (product_id) or a free-text description with your own price, then recalculate the quote's totals. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "UUID of the quote to add the item to" },
        product_id: { type: "string", description: "UUID of a catalogue product from search_products, if using one" },
        description: { type: "string", description: "Line description; required if no product_id" },
        quantity: { type: "number", description: "Defaults to 1" },
        unit_price: { type: "number", description: "Required if no product_id; ignored (looked up) if product_id is given" },
      },
      required: ["quote_id"],
      additionalProperties: false,
    },
  },
  {
    name: "accept_quote",
    description:
      "Mark a quote/estimate as accepted by the customer. This automatically generates the invoice from the quote's line items — it is the normal way to turn an estimate into an invoice. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "UUID of the quote to accept" },
      },
      required: ["quote_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_invoice_item",
    description:
      "Add an extra line item to an existing invoice (for example a call-out fee or part added after the fact) and recalculate its totals. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "UUID of the invoice" },
        description: { type: "string" },
        quantity: { type: "number", description: "Defaults to 1" },
        unit_price: { type: "number" },
      },
      required: ["invoice_id", "description", "unit_price"],
      additionalProperties: false,
    },
  },
  {
    name: "create_invoice",
    description:
      "Create a brand-new, standalone invoice for a customer that has no underlying quote (e.g. an ad-hoc job). For a customer who already has an accepted quote, use accept_quote instead. This is a WRITE action and requires explicit user confirmation before it runs.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "UUID of the customer, from resolve_entity or search_customer" },
        description: { type: "string", description: "What the single invoice line is for" },
        amount_excl_vat: { type: "number", description: "Line amount excluding VAT" },
        lead_id: { type: "string", description: "Optional UUID of the related lead/job" },
      },
      required: ["customer_id", "description", "amount_excl_vat"],
      additionalProperties: false,
    },
  },
  {
    name: "search_customers",
    description:
      "Search customers the caller is permitted to see (by name, company, phone or email). Read-only. Results are already scoped server-side to the caller's organisation and role — never ask for or pass an organisation, user or client id.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, company, phone or email fragment" },
        limit: { type: "integer", description: "Max rows, default 10, max 25" },
        offset: { type: "integer", description: "Pagination offset" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_customer_details",
    description:
      "Get a concise profile for one customer (contact details, address, status, open jobs, recent job history). Read-only. If the caller is not permitted to see that customer, it simply returns not found — never say the record exists but is restricted.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "Customer UUID from search_customers or resolve_entity" },
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_inventory",
    description:
      "Search the parts/equipment catalogue with current stock levels. Read-only. Returns selling prices only — never cost price or margin.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, brand, model or product code fragment" },
        category: { type: "string" },
        in_stock_only: { type: "boolean", description: "Only items with stock on hand" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_assigned_jobs",
    description:
      "List the jobs the caller is permitted to see (a technician's own assigned jobs; organisation-wide for admins/dispatchers), optionally filtered by status and scheduled date range. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD, scheduled_for >=" },
        date_to: { type: "string", description: "YYYY-MM-DD, scheduled_for <=" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
];


export interface ExecContext {
  db: SupabaseClient;
  /**
   * Client initialised with the caller's JWT. When present it is used for
   * record-retrieval tools so Postgres RLS is the primary gate. Voice calls
   * have no JWT, so those fall back to the mirrored TS access check below.
   */
  rlsDb?: SupabaseClient;
  userId: string;
  companyId: string | null;
  /**
   * All app_role rows for the caller (e.g. ["field_agent"], ["admin"]).
   * Ops roles (see OPS_ROLES in recordAccess.ts / isOpsRole in ownership.ts)
   * get full company access; everyone else is scoped to their own records
   * by executeTool below. Callers MUST populate this — an empty array is
   * treated as "no ops privileges", never as "unrestricted".
   */
  roles: string[];
  /**
   * The caller's verified auth email, taken from the JWT (text channel) or
   * looked up server-side from the session's user id (voice channel). Used
   * only to resolve a client-portal user to their own customer record.
   */
  email?: string | null;
}

/** Mirrors the quotes/invoices SELECT RLS policies for the voice path. */


/** Splits a free-text name into searchable tokens (drops noise words). */
function nameTokens(input: string): string[] {
  const STOP = new Set([
    "the", "quote", "quotes", "invoice", "invoices", "for", "of", "client",
    "customer", "estimate", "estimates", "open", "please", "mr", "mrs", "ms",
  ]);
  return input
    .replace(/[%,()]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t.toLowerCase()));
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  const h = haystack.replace(/\s+/g, " ").toLowerCase();
  return tokens.every((t) => h.includes(t.toLowerCase()));
}

function scopeCompany<T>(q: T, companyId: string | null): T {
  // A missing company must mean "no rows", never "every tenant's rows".
  // deno-lint-ignore no-explicit-any
  return (q as any).eq("company_id", companyId ?? "00000000-0000-0000-0000-000000000000");
}


/** Executes a whitelisted tool. Throws on any Supabase error. */
export async function executeTool(
  tool: ToolName,
  rawArgs: unknown,
  ctx: ExecContext,
): Promise<{
  rows: Record<string, unknown>[];
  summary: string;
  resource_type?: string;
  resource_id?: string | null;
  access_granted?: boolean;
}> {

  const args = toolSchemas[tool].parse(rawArgs ?? {}) as Record<string, any>;
  const limit = Math.min(Number(args.limit ?? 20), 50);
  const { db, companyId } = ctx;
  const isOps = isOpsRole(ctx.roles);

  switch (tool) {
    // =================================================================
    // Secure read-only slice. Scope is derived entirely server-side from
    // the verified caller identity — no scoping input is accepted.
    // =================================================================
    case "search_customers": {
      const scope = await resolveScope(db, ctx.userId, companyId, ctx.roles, ctx.email);
      if (scope.customerIds && scope.customerIds.size === 0) {
        return { rows: [], summary: "No customers found.", access_granted: true, resource_type: "customer" };
      }
      const raw = String(args.query).trim();
      const tokens = nameTokens(raw);
      const fields = ["first_name", "last_name", "company_name", "phone", "email"];
      const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")];
      const orFilter = patterns.flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`)).join(",");
      const take = Math.min(Number(args.limit ?? 10), 25);
      const from = Number(args.offset ?? 0);
      let q = db.from("customers")
        .select("id, first_name, last_name, company_name, phone, email, city, status")
        .or(orFilter)
        .order("last_name", { ascending: true })
        .range(from, from + take - 1);
      q = scopeCompany(q, companyId);
      if (scope.customerIds) q = q.in("id", [...scope.customerIds]);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(
        tool,
        ((data ?? []) as Record<string, any>[]).map((c) => ({
          ...c,
          display_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Unnamed",
        })),
      );
      return {
        rows,
        summary: rows.length ? `${rows.length} customer(s)` : "No customers found.",
        resource_type: "customer",
        access_granted: true,
      };
    }

    case "get_customer_details": {
      const scope = await resolveScope(db, ctx.userId, companyId, ctx.roles, ctx.email);
      const notFound = {
        rows: [] as Record<string, unknown>[],
        summary: "No customer found with that reference.",
        resource_type: "customer",
        resource_id: String(args.customer_id),
        access_granted: false,
      };
      if (scope.customerIds && !scope.customerIds.has(String(args.customer_id))) return notFound;

      let cq = db.from("customers")
        .select(
          "id, first_name, last_name, company_name, phone, email, primary_address_line1, city, postal_code, status",
        )
        .eq("id", args.customer_id)
        .limit(1);
      cq = scopeCompany(cq, companyId);
      const { data: custRows, error } = await cq;
      if (error) throw error;
      const customer = ((custRows ?? []) as Record<string, any>[])[0];
      // Same response whether the row belongs to another organisation or
      // does not exist at all — never disclose existence.
      if (!customer) return notFound;

      let jq = db.from("jobs")
        .select("id, title, status, scheduled_for")
        .eq("customer_id", customer.id)
        .order("scheduled_for", { ascending: false, nullsFirst: false })
        .limit(20);
      jq = scopeCompany(jq, companyId);
      const { data: jobRows } = await jq;
      let jobs = ((jobRows ?? []) as Record<string, any>[]);
      if (scope.jobIds) jobs = jobs.filter((j) => scope.jobIds!.has(String(j.id)));

      let qq = db.from("quotes").select("id").eq("customer_id", customer.id).limit(50);
      qq = scopeCompany(qq, companyId);
      const { data: quoteRows } = await qq;

      const closed = new Set(["completed", "cancelled", "closed"]);
      const detail = {
        id: customer.id,
        display_name: [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
          customer.company_name || "Unnamed",
        company_name: customer.company_name,
        phone: customer.phone,
        email: customer.email,
        primary_address_line1: customer.primary_address_line1,
        city: customer.city,
        postal_code: customer.postal_code,
        status: customer.status,
        open_job_count: jobs.filter((j) => !closed.has(String(j.status ?? "").toLowerCase())).length,
        recent_jobs: jobs.slice(0, 5).map((j) => ({
          id: j.id,
          title: j.title,
          status: j.status,
          scheduled_for: j.scheduled_for,
        })),
        quote_count: scope.persona === "ops" ? (quoteRows ?? []).length : undefined,
        last_job_at: jobs[0]?.scheduled_for ?? null,
      };
      const rows = scrub(tool, [detail]);
      return {
        rows,
        summary: `${detail.display_name}: ${detail.open_job_count} open job(s)`,
        resource_type: "customer",
        resource_id: String(customer.id),
        access_granted: true,
      };
    }

    case "search_inventory": {
      const scope = await resolveScope(db, ctx.userId, companyId, ctx.roles, ctx.email);
      if (!scope.canSeeInventory) {
        return {
          rows: [],
          summary: "No inventory available for this account.",
          resource_type: "inventory",
          access_granted: false,
        };
      }
      const raw = String(args.query).trim();
      const tokens = nameTokens(raw);
      const fields = ["name", "short_name", "model", "product_code", "brand"];
      const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")];
      const orFilter = patterns.flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`)).join(",");
      const take = Math.min(Number(args.limit ?? 10), 25);
      const from = Number(args.offset ?? 0);
      let q = db.from("supplier_products")
        .select(
          "id, name, short_name, category, subcategory, brand, model, product_code, selling_price, sell_price_incl_vat, is_price_on_request, unit_type",
        )
        .eq("is_active", true)
        .or("archived.is.false,archived.is.null")
        .or(orFilter)
        .range(from, from + take - 1);
      if (args.category) q = q.ilike("category", `%${args.category}%`);
      const { data, error } = await q;
      if (error) throw error;
      const products = (data ?? []) as Record<string, any>[];

      let stockByProduct = new Map<string, number>();
      if (products.length) {
        const { data: stock } = await db.from("inventory_stock")
          .select("product_id, quantity").in("product_id", products.map((p) => p.id));
        stockByProduct = new Map(
          ((stock ?? []) as { product_id: string; quantity: number | null }[])
            .map((s) => [String(s.product_id), Number(s.quantity ?? 0)]),
        );
      }
      let enriched = products.map((p) => ({
        ...p,
        quantity_on_hand: stockByProduct.get(String(p.id)) ?? 0,
        in_stock: (stockByProduct.get(String(p.id)) ?? 0) > 0,
      }));
      if (args.in_stock_only) enriched = enriched.filter((p) => p.in_stock);
      const rows = scrub(tool, enriched);
      return {
        rows,
        summary: rows.length ? `${rows.length} item(s)` : "No inventory items found.",
        resource_type: "inventory",
        access_granted: true,
      };
    }

    case "get_assigned_jobs": {
      const scope = await resolveScope(db, ctx.userId, companyId, ctx.roles, ctx.email);
      if (scope.jobIds && scope.jobIds.size === 0) {
        return { rows: [], summary: "No jobs found.", resource_type: "job", access_granted: true };
      }
      const take = Math.min(Number(args.limit ?? 20), 50);
      const from = Number(args.offset ?? 0);
      let q = db.from("jobs")
        .select("id, title, status, priority, job_type, address, scheduled_for, customer_id")
        .order("scheduled_for", { ascending: true, nullsFirst: false })
        .range(from, from + take - 1);
      q = scopeCompany(q, companyId);
      if (scope.jobIds) q = q.in("id", [...scope.jobIds]);
      if (args.status) q = q.eq("status", args.status);
      if (args.date_from) q = q.gte("scheduled_for", `${args.date_from}T00:00:00Z`);
      if (args.date_to) q = q.lte("scheduled_for", `${args.date_to}T23:59:59Z`);
      const { data, error } = await q;
      if (error) throw error;
      const jobs = (data ?? []) as Record<string, any>[];

      const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean).map(String))];
      let names = new Map<string, string>();
      if (customerIds.length) {
        let cq = db.from("customers").select("id, first_name, last_name, company_name").in("id", customerIds);
        cq = scopeCompany(cq, companyId);
        const { data: custs } = await cq;
        names = new Map(
          ((custs ?? []) as Record<string, any>[]).map((c) => [
            String(c.id),
            [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Unnamed",
          ]),
        );
      }
      const rows = scrub(
        tool,
        jobs.map((j) => ({ ...j, customer_name: j.customer_id ? names.get(String(j.customer_id)) ?? null : null })),
      );
      return {
        rows,
        summary: rows.length ? `${rows.length} job(s)` : "No jobs found.",
        resource_type: "job",
        access_granted: true,
      };
    }

    case "query_leads": {
      let q = db.from("leads").select(
        "id, customer_name, phone, service_type, status, lead_status, priority, lead_priority, primary_intent, normalized_address, customer_address, created_at, scheduled_date, assigned_agent_id, technician_name",
      ).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
      q = scopeCompany(q, companyId);
      // Non-ops roles (field agents / viewers) only ever see leads assigned to them.
      if (!isOps) q = q.eq("assigned_agent_id", ctx.userId);
      if (args.status) q = q.eq("status", args.status);
      if (args.priority) q = q.eq("lead_priority", args.priority);
      if (args.date_from) q = q.gte("created_at", `${args.date_from}T00:00:00Z`);
      if (args.date_to) q = q.lte("created_at", `${args.date_to}T23:59:59Z`);
      if (args.location) {
        const pat = `%${args.location}%`;
        q = q.or(`normalized_address.ilike.${pat},customer_address.ilike.${pat}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
      return { rows, summary: `${rows.length} lead(s)` };
    }

    case "get_overdue_invoices": {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(args.days_overdue ?? 0));
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      let q = db.from("invoices").select(
        "id, invoice_number, customer_name, customer_address, grand_total, status, due_date, issue_date",
      ).not("status", "in", "(paid,cancelled,void)")
        .not("due_date", "is", null)
        .lte("due_date", cutoffStr)
        .order("due_date", { ascending: true })
        .limit(limit);
      q = scopeCompany(q, companyId);
      // Non-ops roles only see invoices billed under their own name.
      if (!isOps) q = q.eq("agent_id", ctx.userId);
      if (args.location) q = q.ilike("customer_address", `%${args.location}%`);
      const { data, error } = await q;
      if (error) throw error;
      const today = new Date();
      const enriched = (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        days_overdue: Math.max(
          0,
          Math.floor((today.getTime() - new Date(String(r.due_date)).getTime()) / 86400000),
        ),
      }));
      const rows = scrub(tool, enriched);
      return { rows, summary: `${rows.length} overdue invoice(s)` };
    }

    case "query_jobs": {
      // Non-ops roles can only ever see their own jobs: ignore whatever
      // staff_id was requested (asking about a colleague's jobs is not
      // allowed) and force the filter to the caller themselves.
      const staffIdFilter = isOps ? args.staff_id : ctx.userId;
      let jobIds: string[] | null = null;
      if (staffIdFilter) {
        const { data: asg, error: asgErr } = await db.from("assignments")
          .select("job_id").eq("profile_id", staffIdFilter).limit(200);
        if (asgErr) throw asgErr;
        jobIds = (asg ?? []).map((a: { job_id: string }) => a.job_id).filter(Boolean);
        if (!isOps) {
          // A field agent should also see jobs they created themselves even
          // if not formally assigned via the assignments table.
          const { data: created } = await db.from("jobs").select("id")
            .eq("created_by", ctx.userId).eq("company_id", companyId).limit(200);
          for (const j of (created ?? []) as { id: string }[]) jobIds.push(j.id);
          jobIds = [...new Set(jobIds)];
        }
        if (jobIds.length === 0) return { rows: [], summary: "0 job(s)" };
      }
      let q = db.from("jobs").select(
        "id, title, status, priority, job_type, address, scheduled_for, created_at, customer_id, lead_id",
      ).order("scheduled_for", { ascending: true, nullsFirst: false }).limit(limit);
      q = scopeCompany(q, companyId);
      if (args.status) q = q.eq("status", args.status);
      if (jobIds) q = q.in("id", jobIds);

      if (args.date_from) q = q.gte("scheduled_for", `${args.date_from}T00:00:00Z`);
      if (args.date_to) q = q.lte("scheduled_for", `${args.date_to}T23:59:59Z`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
      return { rows, summary: `${rows.length} job(s)` };
    }

    case "search_customer": {
      // Non-ops roles can only search customers they are actually connected
      // to (via an assigned lead, a job, a quote or an invoice) — never the
      // whole company's client list.
      let ownedCustomerIds: Set<string> | null = null;
      if (!isOps) {
        const scope = await getOwnedScope(db, ctx.userId, companyId);
        ownedCustomerIds = scope.customerIds;
        if (ownedCustomerIds.size === 0) return { rows: [], summary: "0 customer(s)" };
      }
      const raw = String(args.query).trim();
      const tokens = nameTokens(raw);
      const fields = ["first_name", "last_name", "company_name", "phone", "email"];
      const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")];
      const orFilter = patterns
        .flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`))
        .join(",");
      let q = db.from("customers").select(
        "id, first_name, last_name, company_name, phone, email, primary_address_line1, city, status",
      ).or(orFilter).limit(50);
      q = scopeCompany(q, companyId);
      if (ownedCustomerIds) q = q.in("id", [...ownedCustomerIds]);
      const { data, error } = await q;
      if (error) throw error;
      // Prefer rows matching every token of the query (handles "Andre Blom"
      // split across first_name/last_name, and stray double spaces).
      const all = (data ?? []) as Record<string, any>[];
      const strict = tokens.length > 1
        ? all.filter((r) => matchesAllTokens(
          `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.company_name ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`,
          tokens,
        ))
        : all;
      const rows = scrub(tool, (strict.length ? strict : all).slice(0, Math.min(limit, 25)));
      return { rows, summary: `${rows.length} customer(s)` };
    }


    case "get_staff_availability": {
      let q = db.from("profiles").select(
        "id, full_name, availability_status, dispatch_role, dispatch_active, skills, max_travel_km",
      ).limit(limit);
      q = scopeCompany(q, companyId);
      if (args.status) q = q.eq("availability_status", args.status);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
      return { rows, summary: `${rows.length} staff member(s)` };
    }

    case "get_unassigned_queue": {
      // The dispatch/escalation queue is a management view, not client info
      // — field agents don't get it, ops roles do.
      if (!isOps) {
        return { rows: [], summary: "The unassigned queue is limited to dispatchers and admins." };
      }
      let q = db.from("unassigned_queue").select(
        "id, lead_id, reason, priority, escalate_at, escalated, resolved, created_at",
      ).order("created_at", { ascending: false }).limit(limit);
      q = scopeCompany(q, companyId);
      if (args.only_unresolved !== false) q = q.eq("resolved", false);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
      return { rows, summary: `${rows.length} queued lead(s)` };
    }

    case "get_quote":
    case "get_invoice": {
      const isQuote = tool === "get_quote";
      const table = isQuote ? "quotes" : "invoices";
      const numberCol = isQuote ? "quote_number" : "invoice_number";
      const cols = isQuote
        ? "id, quote_number, customer_name, status, total, subtotal, vat_amount, valid_until, created_at, sent_at, accepted_at, lead_id, customer_id, sales_engineer_id"
        : "id, invoice_number, customer_name, status, grand_total, subtotal, tax_amount, due_date, issue_date, paid_date, created_at, quote_id, customer_id, agent_id";
      const raw = String(args.identifier).trim();
      const safe = raw.replace(/[%,()]/g, "");
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);

      // Primary gate is RLS via the caller's JWT client when we have one.
      const client = ctx.rlsDb ?? db;
      const tokens = nameTokens(raw);

      // Resolve matching customers first: names are stored split across
      // first_name/last_name, and denormalised customer_name can contain
      // stray whitespace, so plain ilike on the whole phrase misses rows.
      let customerIds: string[] = [];
      if (!isUuid && tokens.length) {
        let cq = db.from("customers")
          .select("id, first_name, last_name, company_name")
          .or(tokens.flatMap((t) => [
            `first_name.ilike.%${t}%`,
            `last_name.ilike.%${t}%`,
            `company_name.ilike.%${t}%`,
          ]).join(","))
          .limit(50);
        cq = scopeCompany(cq, companyId);
        const { data: custs } = await cq;
        const matched = ((custs ?? []) as Record<string, any>[]).filter((c) =>
          tokens.length === 1 || matchesAllTokens(
            `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.company_name ?? ""}`,
            tokens,
          )
        );
        customerIds = matched.map((c) => String(c.id));
      }

      const orParts = isUuid ? [] : [
        ...tokens.map((t) => `${numberCol}.ilike.%${t}%`),
        ...tokens.map((t) => `customer_name.ilike.%${t}%`),
        ...customerIds.map((id) => `customer_id.eq.${id}`),
      ];
      if (!isUuid && orParts.length === 0) orParts.push(`${numberCol}.ilike.%${safe}%`);

      let q = client.from(table).select(cols)
        .order("created_at", { ascending: false })
        .limit(50);
      q = scopeCompany(q, companyId);
      q = isUuid ? (q as any).eq("id", raw) : (q as any).or(orParts.join(","));

      const { data, error } = await q;
      if (error) throw error;
      let found = (data ?? []) as Record<string, any>[];

      // Narrow to rows that satisfy the whole phrase where possible.
      if (!isUuid && tokens.length) {
        const strict = found.filter((r) =>
          (r.customer_id && customerIds.includes(String(r.customer_id))) ||
          matchesAllTokens(String(r.customer_name ?? ""), tokens) ||
          matchesAllTokens(String(r[numberCol] ?? ""), tokens)
        );
        if (strict.length) found = strict;
      }
      found = found.slice(0, Math.min(Number(args.limit ?? 5), 10));


      // Voice path has no JWT: mirror the RLS rules in code.
      if (!ctx.rlsDb && found.length) {
        const checked: Record<string, any>[] = [];
        for (const row of found) {
          if (await hasRecordAccess(db, ctx.userId, isQuote ? "quote" : "invoice", row)) {
            checked.push(row);
          }
        }
        found = checked;
      }

      const rows = scrub(tool, found);
      const label = isQuote ? "quote" : "invoice";
      return {
        rows,
        // Never disclose that a hidden record exists.
        summary: rows.length
          ? `${rows.length} ${label}(s) found`
          : `No ${label} found matching "${raw}"`,
        resource_type: label,
        resource_id: (found[0]?.id as string) ?? null,
        access_granted: rows.length > 0,
      };
    }

    case "resolve_entity": {
      const { data, error } = await db.rpc("search_entities_fuzzy", {
        p_entity_type: args.entity_type,
        p_query: args.query,
        p_company_id: companyId,
        // Ask the DB for extra candidates when we'll post-filter by
        // ownership below, so a non-ops caller doesn't lose real matches
        // just because someone else's records ranked higher.
        p_limit: isOps ? Math.min(Number(args.limit ?? 5), 5) : 25,
      });
      if (error) throw error;

      let candidates = (data ?? []) as EntityCandidate[];
      // Non-ops roles must never have resolve_entity reveal (even fuzzily)
      // customers, leads, jobs or quotes that aren't theirs — that would be
      // a backdoor around the same scoping applied to the read tools above.
      // Products and staff are not client-sensitive, so they pass through.
      if (!isOps && ["customer", "lead", "job", "quote", "all"].includes(args.entity_type)) {
        const scope = await getOwnedScope(db, ctx.userId, companyId);
        const ownedSets: Partial<Record<EntityCandidate["entity_type"], Set<string>>> = {
          customer: scope.customerIds,
          lead: scope.leadIds,
          job: scope.jobIds,
          quote: scope.quoteIds,
        };
        candidates = candidates.filter((c) => {
          const owned = ownedSets[c.entity_type];
          return owned ? owned.has(c.id) : true; // product / staff: unfiltered
        });
      }
      candidates = candidates.slice(0, Math.min(Number(args.limit ?? 5), 5));

      const resolution = resolveCandidates(
        args.query,
        args.entity_type,
        candidates,
        { riskyAction: args.for_action === "write" },
      );

      return {
        rows: scrub(tool, resolution.candidates as unknown as Record<string, unknown>[]),
        summary: resolution.prompt,
        resource_type: `resolution:${resolution.decision}`,
        resource_id: resolution.chosen?.id ?? null,
        access_granted: resolution.decision === "auto",
      };
    }

    case "create_quote_draft": {

      const { data: lead, error: leadErr } = await db.from("leads")
        .select("id, customer_id, customer_name, company_id, assigned_agent_id")
        .eq("id", args.lead_id).maybeSingle();
      if (leadErr) throw leadErr;
      if (!lead) throw new Error("Lead not found");
      if (!companyId || lead.company_id !== companyId) {
        throw new Error("Lead belongs to another company");
      }
      // Field agents can only build estimates for their own leads.
      if (!isOps && lead.assigned_agent_id !== ctx.userId) {
        throw new Error("That lead is not assigned to you.");
      }
      const { data, error } = await db.from("quotes").insert({
        lead_id: lead.id,
        customer_id: lead.customer_id,
        customer_name: lead.customer_name,
        company_id: lead.company_id ?? companyId,
        sales_engineer_id: ctx.userId,
        status: "draft",
        notes: args.notes ?? null,
        subtotal: 0,
        vat_amount: 0,
        total: 0,
      }).select("id, quote_number, status, customer_id, lead_id, total").single();
      if (error) throw error;
      return { rows: scrub(tool, [data]), summary: `Draft quote ${data.quote_number ?? ""} created` };
    }

    case "search_products": {
      const raw = String(args.query).trim();
      const tokens = nameTokens(raw);
      const fields = ["name", "short_name", "description", "model", "product_code", "brand", "model_range"];
      const patterns = tokens.length ? tokens : [raw.replace(/[%,()]/g, "")];
      const orFilter = patterns.flatMap((t) => fields.map((f) => `${f}.ilike.%${t}%`)).join(",");
      let q = db.from("supplier_products").select(
        "id, name, short_name, category, subcategory, brand, model, product_code, selling_price, sell_price_incl_vat, price_includes_vat, is_price_on_request, unit_type, capacity_btu, kw",
      ).eq("is_active", true).or("archived.is.false,archived.is.null").or(orFilter).limit(Math.min(Number(args.limit ?? 15), 25));
      if (args.category) q = q.ilike("category", `%${args.category}%`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
      return { rows, summary: `${rows.length} product(s)` };
    }

    case "add_quote_item": {
      const { data: quote, error: quoteErr } = await db.from("quotes")
        .select("id, company_id, sales_engineer_id, status, discount_type, discount_value, vat_rate")
        .eq("id", args.quote_id).maybeSingle();
      if (quoteErr) throw quoteErr;
      if (!quote || !companyId || quote.company_id !== companyId) throw new Error("Quote not found");
      if (!isOps && quote.sales_engineer_id !== ctx.userId) throw new Error("You don't have access to that quote");

      let description = args.description ? String(args.description) : null;
      let unitPrice = args.unit_price != null ? Number(args.unit_price) : null;
      if (args.product_id) {
        const { data: product, error: prodErr } = await db.from("supplier_products")
          .select("id, name, short_name, selling_price, sell_price_incl_vat, price_includes_vat")
          .eq("id", args.product_id).maybeSingle();
        if (prodErr) throw prodErr;
        if (!product) throw new Error("Product not found");
        description = description ?? product.name ?? product.short_name ?? "Item";
        // Quote line items are priced ex-VAT (the quote's own vat_amount is
        // computed separately), so prefer the excl-VAT selling price.
        unitPrice = unitPrice ?? product.selling_price ?? product.sell_price_incl_vat ?? 0;
      }
      if (!description) throw new Error("A description or product_id is required");
      if (unitPrice == null) throw new Error("A unit_price or product_id is required");
      const quantity = args.quantity != null ? Number(args.quantity) : 1;
      const lineTotal = Math.round(quantity * unitPrice * 100) / 100;

      const { error: insErr } = await db.from("quote_line_items").insert({
        quote_id: quote.id,
        description,
        quantity,
        unit_price: unitPrice,
        total: lineTotal,
      });
      if (insErr) throw insErr;

      const { data: items, error: itemsErr } = await db.from("quote_line_items")
        .select("total").eq("quote_id", quote.id);
      if (itemsErr) throw itemsErr;
      const subtotal = (items ?? []).reduce((s: number, r: { total: number | null }) => s + Number(r.total ?? 0), 0);
      const discountAmt = quote.discount_type === "percentage"
        ? subtotal * (Number(quote.discount_value ?? 0) / 100)
        : quote.discount_type === "fixed"
        ? Number(quote.discount_value ?? 0)
        : 0;
      const vatRate = quote.vat_rate ?? DEFAULT_VAT_RATE;
      const vatAmount = Math.max(0, subtotal - discountAmt) * vatRate;
      const total = Math.max(0, subtotal - discountAmt) + vatAmount;

      const { error: updErr } = await db.from("quotes").update({
        subtotal, vat_amount: vatAmount, total,
      }).eq("id", quote.id);
      if (updErr) throw updErr;

      return {
        rows: scrub(tool, [{ id: quote.id, quote_id: quote.id, description, quantity, unit_price: unitPrice, total: lineTotal, quote_total: total }]),
        summary: `Added "${description}" x${quantity} to the quote. New total: R${total.toFixed(2)}`,
      };
    }

    case "accept_quote": {
      const { data: quote, error: quoteErr } = await db.from("quotes")
        .select("id, company_id, sales_engineer_id, status, quote_number")
        .eq("id", args.quote_id).maybeSingle();
      if (quoteErr) throw quoteErr;
      if (!quote || !companyId || quote.company_id !== companyId) throw new Error("Quote not found");
      if (!isOps && quote.sales_engineer_id !== ctx.userId) throw new Error("You don't have access to that quote");

      if (quote.status === "accepted") {
        const { data: existingInvoice } = await db.from("invoices")
          .select("id, invoice_number, status").eq("quote_id", quote.id).maybeSingle();
        return {
          rows: scrub(tool, [{
            id: quote.id, quote_number: quote.quote_number, status: "accepted",
            accepted_at: null, invoice_id: existingInvoice?.id ?? null,
            invoice_number: existingInvoice?.invoice_number ?? null,
          }]),
          summary: existingInvoice
            ? `Quote ${quote.quote_number ?? ""} was already accepted — invoice ${existingInvoice.invoice_number} exists.`
            : `Quote ${quote.quote_number ?? ""} was already accepted.`,
        };
      }

      const { data: updated, error: updErr } = await db.from("quotes").update({
        status: "accepted", accepted_at: new Date().toISOString(), accepted_by: ctx.userId,
      }).eq("id", quote.id).select("id, quote_number, status, accepted_at").single();
      if (updErr) throw updErr;

      // The create_invoice_from_accepted_quote() DB trigger fires on this
      // status transition and creates the invoice + invoice_items for us.
      const { data: invoice } = await db.from("invoices")
        .select("id, invoice_number").eq("quote_id", quote.id).maybeSingle();

      return {
        rows: scrub(tool, [{
          id: updated.id, quote_number: updated.quote_number, status: updated.status,
          accepted_at: updated.accepted_at, invoice_id: invoice?.id ?? null,
          invoice_number: invoice?.invoice_number ?? null,
        }]),
        summary: invoice
          ? `Quote ${updated.quote_number ?? ""} accepted — invoice ${invoice.invoice_number} created.`
          : `Quote ${updated.quote_number ?? ""} accepted.`,
      };
    }

    case "add_invoice_item": {
      const { data: invoice, error: invErr } = await db.from("invoices")
        .select("id, company_id, agent_id, tax_rate")
        .eq("id", args.invoice_id).maybeSingle();
      if (invErr) throw invErr;
      if (!invoice || !companyId || invoice.company_id !== companyId) throw new Error("Invoice not found");
      if (!isOps && invoice.agent_id !== ctx.userId) throw new Error("You don't have access to that invoice");

      const quantity = args.quantity != null ? Number(args.quantity) : 1;
      const unitPrice = Number(args.unit_price);
      const amount = Math.round(quantity * unitPrice * 100) / 100;

      const { error: insErr } = await db.from("invoice_items").insert({
        invoice_id: invoice.id, description: args.description, quantity, unit_price: unitPrice, amount,
      });
      if (insErr) throw insErr;

      const { data: items, error: itemsErr } = await db.from("invoice_items")
        .select("amount").eq("invoice_id", invoice.id);
      if (itemsErr) throw itemsErr;
      const subtotal = (items ?? []).reduce((s: number, r: { amount: number | null }) => s + Number(r.amount ?? 0), 0);
      const taxRate = invoice.tax_rate ?? DEFAULT_VAT_RATE;
      const taxAmount = subtotal * taxRate;
      const grandTotal = subtotal + taxAmount;

      const { error: updErr } = await db.from("invoices").update({
        subtotal, tax_amount: taxAmount, grand_total: grandTotal,
      }).eq("id", invoice.id);
      if (updErr) throw updErr;

      return {
        rows: scrub(tool, [{ id: invoice.id, invoice_id: invoice.id, description: args.description, quantity, unit_price: unitPrice, amount, invoice_total: grandTotal }]),
        summary: `Added "${args.description}" x${quantity} to the invoice. New total: R${grandTotal.toFixed(2)}`,
      };
    }

    case "create_invoice": {
      if (!isOps) {
        const scope = await getOwnedScope(db, ctx.userId, companyId);
        if (!scope.customerIds.has(args.customer_id)) {
          throw new Error("You don't have access to that customer");
        }
      }
      const { data: customer, error: custErr } = await db.from("customers")
        .select("id, company_id, name, phone, email, address")
        .eq("id", args.customer_id).maybeSingle();
      if (custErr) throw custErr;
      if (!customer || !companyId || customer.company_id !== companyId) throw new Error("Customer not found");

      const { data: invNumber, error: numErr } = await db.rpc("generate_invoice_number");
      if (numErr) throw numErr;

      const amount = Number(args.amount_excl_vat);
      const taxAmount = amount * DEFAULT_VAT_RATE;
      const grandTotal = amount + taxAmount;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const { data: invoice, error: invErr } = await db.from("invoices").insert({
        company_id: companyId,
        customer_id: customer.id,
        customer_name: customer.name ?? "",
        customer_phone: customer.phone ?? null,
        customer_email: customer.email ?? null,
        customer_address: customer.address ?? null,
        agent_id: ctx.userId,
        lead_id: args.lead_id ?? null,
        invoice_number: invNumber,
        subtotal: amount,
        tax_rate: DEFAULT_VAT_RATE,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        due_date: dueDate.toISOString().slice(0, 10),
        status: "draft",
        line_items: [],
      }).select("id, invoice_number, status, customer_id, grand_total").single();
      if (invErr) throw invErr;

      const { error: itemErr } = await db.from("invoice_items").insert({
        invoice_id: invoice.id, description: args.description, quantity: 1, unit_price: amount, amount,
      });
      if (itemErr) throw itemErr;

      return { rows: scrub(tool, [invoice]), summary: `Invoice ${invoice.invoice_number} created for R${grandTotal.toFixed(2)}` };
    }

    case "assign_job": {
      const { data: job, error: jobErr } = await db.from("jobs")
        .select("id, company_id").eq("id", args.job_id).maybeSingle();
      if (jobErr) throw jobErr;
      if (!job) throw new Error("Job not found");
      if (!companyId || job.company_id !== companyId) {
        throw new Error("Job belongs to another company");
      }
      const { data: staff, error: staffErr } = await db.from("profiles")
        .select("id, full_name").eq("id", args.staff_id).maybeSingle();
      if (staffErr) throw staffErr;
      if (!staff) throw new Error("Staff member not found");

      const { error: asgErr } = await db.from("assignments").insert({
        job_id: args.job_id,
        profile_id: args.staff_id,
        assigned_by: ctx.userId,
        assignment_type: "manual",
        status: "assigned",
      });
      if (asgErr) throw asgErr;

      const { data, error } = await db.from("jobs")
        .update({ status: "assigned" })
        .eq("id", args.job_id)
        .select("id, status, title, scheduled_for")
        .single();
      if (error) throw error;
      const row = { ...data, assigned_staff_id: args.staff_id };
      return { rows: scrub(tool, [row]), summary: `Job assigned to ${staff.full_name ?? "staff member"}` };

    }
  }
}
