/**
 * Server-side persona + scope resolution for the read-only AI assistant tools.
 *
 * NOTHING here is ever taken from the browser or the voice agent: the caller's
 * user id and company come from the verified Supabase JWT (text channel) or the
 * HMAC-signed voice session (voice channel), and roles are read fresh from
 * `user_roles` inside the edge function. Any user_id / organisation_id / role /
 * client_id / technician_id sent in a tool payload is ignored by construction —
 * the tool schemas do not accept those fields.
 */

import { OPS_ROLES } from "./recordAccess.ts";
import { getOwnedScope, type OwnershipDb } from "./ownership.ts";

export type Persona = "ops" | "technician" | "sales" | "client";

const TECH_ROLES = new Set(["field_agent", "technician"]);
const SALES_ROLES = new Set(["sales", "estimator", "sales_engineer", "sales_agent"]);
const CLIENT_ROLES = new Set(["client", "customer", "portal_user"]);

/** Most-privileged role wins; unknown/viewer falls back to the most restrictive staff persona. */
export function resolvePersona(roles: string[] | null | undefined): Persona {
  const r = roles ?? [];
  if (r.some((x) => OPS_ROLES.has(x))) return "ops";
  if (r.some((x) => SALES_ROLES.has(x))) return "sales";
  if (r.some((x) => TECH_ROLES.has(x))) return "technician";
  if (r.some((x) => CLIENT_ROLES.has(x))) return "client";
  return "technician";
}

export interface AssistantScope {
  persona: Persona;
  /** null = company-wide (ops). Otherwise the exact allowed ids. */
  customerIds: Set<string> | null;
  jobIds: Set<string> | null;
  /** false for client-portal users: catalogue/stock is internal data. */
  canSeeInventory: boolean;
}

/** Jobs a technician is assigned to (or created) plus the customers on those jobs. */
async function technicianScope(db: OwnershipDb, userId: string, companyId: string | null) {
  const jobIds = new Set<string>();
  const customerIds = new Set<string>();

  const [assignRes, createdRes] = await Promise.all([
    db.from("assignments").select("job_id").eq("profile_id", userId).limit(500),
    db.from("jobs").select("id, customer_id").eq("created_by", userId).eq("company_id", companyId).limit(500),
  ]);
  for (const a of (assignRes.data ?? []) as { job_id: string }[]) if (a.job_id) jobIds.add(a.job_id);
  for (const j of (createdRes.data ?? []) as { id: string; customer_id: string | null }[]) {
    jobIds.add(j.id);
    if (j.customer_id) customerIds.add(String(j.customer_id));
  }
  if (jobIds.size) {
    const { data } = await db.from("jobs").select("id, customer_id, company_id")
      .in("id", [...jobIds]).eq("company_id", companyId).limit(500);
    const visible = new Set<string>();
    for (const j of (data ?? []) as { id: string; customer_id: string | null }[]) {
      visible.add(String(j.id));
      if (j.customer_id) customerIds.add(String(j.customer_id));
    }
    // Drop assignments pointing at another organisation's jobs.
    for (const id of [...jobIds]) if (!visible.has(id)) jobIds.delete(id);
  }
  return { jobIds, customerIds };
}

/** Client-portal user: only the customer record matching their verified auth email. */
async function clientScope(db: OwnershipDb, email: string | null | undefined, companyId: string | null) {
  const customerIds = new Set<string>();
  if (!email) return { customerIds, jobIds: new Set<string>() };
  const normalized = email.trim().toLowerCase();
  const { data } = await db.from("customers").select("id")
    .eq("company_id", companyId).or(`normalized_email.eq.${normalized},email.eq.${normalized}`).limit(20);
  for (const c of (data ?? []) as { id: string }[]) customerIds.add(String(c.id));

  const jobIds = new Set<string>();
  if (customerIds.size) {
    const { data: jobs } = await db.from("jobs").select("id")
      .in("customer_id", [...customerIds]).eq("company_id", companyId).limit(500);
    for (const j of (jobs ?? []) as { id: string }[]) jobIds.add(String(j.id));
  }
  return { customerIds, jobIds };
}

export async function resolveScope(
  db: OwnershipDb,
  userId: string,
  companyId: string | null,
  roles: string[],
  email?: string | null,
): Promise<AssistantScope> {
  const persona = resolvePersona(roles);
  if (!companyId) {
    // No organisation => no rows, never "all rows".
    return { persona, customerIds: new Set(), jobIds: new Set(), canSeeInventory: false };
  }
  if (persona === "ops") {
    return { persona, customerIds: null, jobIds: null, canSeeInventory: true };
  }
  if (persona === "client") {
    const { customerIds, jobIds } = await clientScope(db, email, companyId);
    return { persona, customerIds, jobIds, canSeeInventory: false };
  }
  if (persona === "technician") {
    const { customerIds, jobIds } = await technicianScope(db, userId, companyId);
    return { persona, customerIds, jobIds, canSeeInventory: true };
  }
  // sales / estimator: their own leads, quotes, jobs and the customers on them.
  const owned = await getOwnedScope(db, userId, companyId);
  return {
    persona,
    customerIds: owned.customerIds,
    jobIds: owned.jobIds,
    canSeeInventory: true,
  };
}

/** Uniform, non-disclosing failure shape for the tool contract. */
export const NOT_FOUND = (what: string) => ({
  rows: [] as Record<string, unknown>[],
  summary: `No ${what} found.`,
  outcome: "not_found" as const,
});

/**
 * Strips values that must never reach the audit log (tokens, secrets, card
 * data) and truncates free text. Only keys, short scalars and ids survive.
 */
const SENSITIVE_KEY = /(token|secret|password|apikey|api_key|authorization|card|cvv|pan|iban|account_number)/i;
export function sanitizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else out[k] = "[object]";
  }
  return out;
}

export interface AssistantAuditEntry {
  userId: string;
  companyId: string | null;
  role: string;
  toolName: string;
  args: unknown;
  resultCount?: number | null;
  outcome: "success" | "not_found" | "access_denied" | "invalid_input" | "rejected" | "error";
  errorCode?: string | null;
  channel: "text" | "voice";
  sessionId?: string | null;
}

/** Best-effort audit write — never throws into the tool path. */
// deno-lint-ignore no-explicit-any
export async function logAssistantAudit(db: any, e: AssistantAuditEntry): Promise<void> {
  try {
    await db.from("assistant_audit_logs").insert({
      user_id: e.userId,
      company_id: e.companyId,
      resolved_role: e.role,
      tool_name: e.toolName.slice(0, 80),
      input: sanitizeArgs(e.args),
      result_count: e.resultCount ?? null,
      outcome: e.outcome,
      error_code: e.errorCode ?? null,
      channel: e.channel,
      session_id: e.sessionId ?? null,
    });
  } catch (err) {
    console.error("[assistant-audit] failed", err instanceof Error ? err.message : err);
  }
}
