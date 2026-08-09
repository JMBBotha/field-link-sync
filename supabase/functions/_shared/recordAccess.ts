/**
 * Record-level access matrix for the NL / voice assistant.
 *
 * This mirrors the database RLS policies (quotes_select_policy /
 * invoices_select_policy) so the voice path — which runs with a session-scoped
 * service client rather than a user JWT — enforces exactly the same rules:
 *
 *   1. Ops roles (admin, dispatcher, platform_super_admin, platform_ops)
 *      -> full access within their company.
 *   2. Owner: quote.sales_engineer_id / invoice.agent_id === userId.
 *   3. Creator of the linked job (quotes only).
 *   4. Assigned technician: an assignments row on a linked job.
 *   5. Offeror: an accepted offer on the quote's lead.
 *
 * Deliberately dependency-free (no npm:/Deno imports) so the same code is
 * covered by the automated regression suite under src/test.
 */

export type RecordKind = "quote" | "invoice";

/** Minimal structural subset of the Supabase client used here. */
export interface AccessDb {
  from(table: string): any;
}

export const OPS_ROLES = new Set([
  "admin",
  "dispatcher",
  "platform_super_admin",
  "platform_ops",
]);

export async function hasRecordAccess(
  db: AccessDb,
  userId: string,
  kind: RecordKind,
  row: Record<string, any>,
): Promise<boolean> {
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: { role: string }) => OPS_ROLES.has(r.role))) return true;

  if (kind === "quote" && row.sales_engineer_id === userId) return true;
  if (kind === "invoice" && row.agent_id === userId) return true;

  const jobFilter = kind === "quote"
    ? `quote_id.eq.${row.id}`
    : `invoice_id.eq.${row.id}${row.quote_id ? `,quote_id.eq.${row.quote_id}` : ""}`;
  const { data: jobs } = await db.from("jobs").select("id, created_by").or(jobFilter);
  const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
  if (kind === "quote" && (jobs ?? []).some((j: { created_by: string }) => j.created_by === userId)) {
    return true;
  }
  if (jobIds.length) {
    const { data: asg } = await db.from("assignments")
      .select("id").in("job_id", jobIds).eq("profile_id", userId).limit(1);
    if ((asg ?? []).length) return true;
  }

  if (kind === "quote" && row.lead_id) {
    const { data: off } = await db.from("offers")
      .select("id").eq("lead_id", row.lead_id).eq("staff_id", userId).eq("status", "accepted").limit(1);
    if ((off ?? []).length) return true;
  }
  return false;
}
