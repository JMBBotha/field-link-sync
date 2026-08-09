import { z } from "npm:zod@3.23.8";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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
  create_quote_draft: z.object({
    lead_id: uuid,
    notes: z.string().max(500).nullable().optional(),
  }),
  assign_job: z.object({
    job_id: uuid,
    staff_id: uuid,
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;

export const TOOL_KIND: Record<ToolName, ToolKind> = {
  query_leads: "read",
  get_overdue_invoices: "read",
  query_jobs: "read",
  search_customer: "read",
  get_staff_availability: "read",
  get_unassigned_queue: "read",
  create_quote_draft: "write",
  assign_job: "write",
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
  create_quote_draft: ["id", "quote_number", "status", "customer_id", "lead_id", "total"],
  assign_job: ["id", "status", "title", "assigned_staff_id", "scheduled_for"],
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
];

export interface ExecContext {
  db: SupabaseClient;
  userId: string;
  companyId: string | null;
}

function scopeCompany<T>(q: T, companyId: string | null): T {
  // deno-lint-ignore no-explicit-any
  return companyId ? (q as any).eq("company_id", companyId) : q;
}

/** Executes a whitelisted tool. Throws on any Supabase error. */
export async function executeTool(
  tool: ToolName,
  rawArgs: unknown,
  ctx: ExecContext,
): Promise<{ rows: Record<string, unknown>[]; summary: string }> {
  const args = toolSchemas[tool].parse(rawArgs ?? {}) as Record<string, any>;
  const limit = Math.min(Number(args.limit ?? 20), 50);
  const { db, companyId } = ctx;

  switch (tool) {
    case "query_leads": {
      let q = db.from("leads").select(
        "id, customer_name, phone, service_type, status, lead_status, priority, lead_priority, primary_intent, normalized_address, customer_address, created_at, scheduled_date, assigned_agent_id, technician_name",
      ).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
      q = scopeCompany(q, companyId);
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
      let jobIds: string[] | null = null;
      if (args.staff_id) {
        const { data: asg, error: asgErr } = await db.from("assignments")
          .select("job_id").eq("profile_id", args.staff_id).limit(200);
        if (asgErr) throw asgErr;
        jobIds = (asg ?? []).map((a: { job_id: string }) => a.job_id).filter(Boolean);
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
      const pat = `%${String(args.query).replace(/[%,()]/g, "")}%`;
      let q = db.from("customers").select(
        "id, first_name, last_name, company_name, phone, email, primary_address_line1, city, status",
      ).or(
        `first_name.ilike.${pat},last_name.ilike.${pat},company_name.ilike.${pat},phone.ilike.${pat},email.ilike.${pat}`,
      ).limit(Math.min(limit, 25));
      q = scopeCompany(q, companyId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = scrub(tool, data ?? []);
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

    case "create_quote_draft": {
      const { data: lead, error: leadErr } = await db.from("leads")
        .select("id, customer_id, customer_name, company_id")
        .eq("id", args.lead_id).maybeSingle();
      if (leadErr) throw leadErr;
      if (!lead) throw new Error("Lead not found");
      if (companyId && lead.company_id && lead.company_id !== companyId) {
        throw new Error("Lead belongs to another company");
      }
      const { data, error } = await db.from("quotes").insert({
        lead_id: lead.id,
        customer_id: lead.customer_id,
        customer_name: lead.customer_name,
        company_id: lead.company_id ?? companyId,
        status: "draft",
        notes: args.notes ?? null,
        subtotal: 0,
        vat_amount: 0,
        total: 0,
      }).select("id, quote_number, status, customer_id, lead_id, total").single();
      if (error) throw error;
      return { rows: scrub(tool, [data]), summary: `Draft quote ${data.quote_number ?? ""} created` };
    }

    case "assign_job": {
      const { data: job, error: jobErr } = await db.from("jobs")
        .select("id, company_id").eq("id", args.job_id).maybeSingle();
      if (jobErr) throw jobErr;
      if (!job) throw new Error("Job not found");
      if (companyId && job.company_id && job.company_id !== companyId) {
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
