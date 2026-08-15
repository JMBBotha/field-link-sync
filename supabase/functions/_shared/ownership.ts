/**
 * Row-level "own records" scoping for the NL / voice assistant.
 *
 * Company-level multi-tenancy is already enforced everywhere via
 * scopeCompany() in nlTools.ts. This module adds the layer underneath that:
 * WITHIN a company, a non-ops user (field_agent / viewer) should only ever
 * see or write records that are actually theirs — their assigned leads,
 * their jobs, their quotes, their invoices, and the customers those records
 * belong to. Ops roles (admin, dispatcher, platform_super_admin,
 * platform_ops) are exempt and keep full company-wide access.
 *
 * This mirrors (and reuses) the OPS_ROLES set from recordAccess.ts so there
 * is exactly one definition of "who bypasses ownership checks".
 */

import { OPS_ROLES } from "./recordAccess.ts";

// deno-lint-ignore no-explicit-any
export interface OwnershipDb {
  from(table: string): any;
}

export function isOpsRole(roles: string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => OPS_ROLES.has(r));
}

export interface OwnedScope {
  leadIds: Set<string>;
  jobIds: Set<string>;
  quoteIds: Set<string>;
  customerIds: Set<string>;
}

/**
 * Computes every lead / job / quote / customer the given user is personally
 * connected to, within their company: leads assigned to them, jobs they
 * created or are assigned to (via the assignments table), quotes they are
 * the sales engineer on, invoices billed under their name, and accepted
 * offers on a lead. Used to scope reads (search_customer, resolve_entity)
 * and writes (add_quote_item, accept_quote, add_invoice_item) for non-ops
 * roles. Always call isOpsRole() first — ops roles should skip this
 * entirely and see the whole company.
 */
export async function getOwnedScope(
  db: OwnershipDb,
  userId: string,
  companyId: string | null,
): Promise<OwnedScope> {
  const leadIds = new Set<string>();
  const jobIds = new Set<string>();
  const quoteIds = new Set<string>();
  const customerIds = new Set<string>();
  const addCustomer = (id: unknown) => {
    if (id) customerIds.add(String(id));
  };

  const [leadsRes, assignRes, createdJobsRes, quotesRes, invoicesRes, offersRes] =
    await Promise.all([
      db.from("leads").select("id, customer_id")
        .eq("assigned_agent_id", userId).eq("company_id", companyId).is("deleted_at", null),
      db.from("assignments").select("job_id").eq("profile_id", userId),
      db.from("jobs").select("id, customer_id, lead_id")
        .eq("created_by", userId).eq("company_id", companyId),
      db.from("quotes").select("id, customer_id, lead_id")
        .eq("sales_engineer_id", userId).eq("company_id", companyId),
      db.from("invoices").select("customer_id")
        .eq("agent_id", userId).eq("company_id", companyId),
      db.from("offers").select("lead_id").eq("staff_id", userId).eq("status", "accepted"),
    ]);

  for (const l of (leadsRes.data ?? []) as { id: string; customer_id: string | null }[]) {
    leadIds.add(l.id);
    addCustomer(l.customer_id);
  }
  for (const inv of (invoicesRes.data ?? []) as { customer_id: string | null }[]) {
    addCustomer(inv.customer_id);
  }
  for (const q of (quotesRes.data ?? []) as { id: string; customer_id: string | null; lead_id: string | null }[]) {
    quoteIds.add(q.id);
    addCustomer(q.customer_id);
    if (q.lead_id) leadIds.add(q.lead_id);
  }

  const assignedJobIds = ((assignRes.data ?? []) as { job_id: string }[]).map((a) => a.job_id);
  for (const id of assignedJobIds) jobIds.add(id);
  for (const j of (createdJobsRes.data ?? []) as { id: string; customer_id: string | null; lead_id: string | null }[]) {
    jobIds.add(j.id);
    addCustomer(j.customer_id);
    if (j.lead_id) leadIds.add(j.lead_id);
  }

  // Fill in customer/lead ids for jobs reached only via assignment (not
  // already covered by createdJobsRes) and pick up accepted-offer leads.
  const extraJobIds = assignedJobIds.filter((id) => !createdJobsRes.data?.some((j: { id: string }) => j.id === id));
  const offerLeadIds = ((offersRes.data ?? []) as { lead_id: string }[]).map((o) => o.lead_id).filter(Boolean);
  for (const id of offerLeadIds) leadIds.add(id);

  const lookups: Promise<void>[] = [];
  if (extraJobIds.length) {
    lookups.push(
      db.from("jobs").select("id, customer_id, lead_id").in("id", extraJobIds).eq("company_id", companyId)
        .then(({ data }: { data: { id: string; customer_id: string | null; lead_id: string | null }[] | null }) => {
          for (const j of data ?? []) {
            addCustomer(j.customer_id);
            if (j.lead_id) leadIds.add(j.lead_id);
          }
        }),
    );
  }
  if (offerLeadIds.length) {
    lookups.push(
      db.from("leads").select("id, customer_id").in("id", offerLeadIds).eq("company_id", companyId)
        .then(({ data }: { data: { id: string; customer_id: string | null }[] | null }) => {
          for (const l of data ?? []) addCustomer(l.customer_id);
        }),
    );
  }
  await Promise.all(lookups);

  return { leadIds, jobIds, quoteIds, customerIds };
}
