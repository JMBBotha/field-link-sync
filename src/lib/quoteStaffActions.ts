/**
 * Staff-side quote actions (Release D2): mark accepted / declined, change salesperson.
 * Pure patch, undo and log-row builders. Acceptance side-effects (deposit invoice) run
 * in the DB trigger on_quote_accepted when status becomes 'accepted' — no app logic here.
 */
import { canSeeMargin } from "@/lib/marginAccess";

export type QuoteStatusSnapshot = {
  status: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  declined_at: string | null;
};

export type ActorAccess = { userId: string | null; roles: string[]; dispatchRole: string | null };
export type QuoteOwnership = { sales_engineer_id?: string | null; created_by?: string | null; owner_id?: string | null };

/** Admin, office and the quote's own sales rep — never field agents (same rule as the margin card). */
export function canMarkQuote(a: ActorAccess, quote: QuoteOwnership): boolean {
  return canSeeMargin({ ...a, mode: "admin", quote });
}

/** Admin or office (dispatcher not tagged sales) only. */
export function canChangeSalesperson(a: ActorAccess): boolean {
  if (!a.userId) return false;
  if (a.roles.includes("admin")) return true;
  return a.roles.includes("dispatcher") && a.dispatchRole !== "sales";
}

export function snapshotOf(q: Partial<QuoteStatusSnapshot>): QuoteStatusSnapshot {
  return { status: q.status ?? null, accepted_at: q.accepted_at ?? null, accepted_by: q.accepted_by ?? null, declined_at: q.declined_at ?? null };
}

/** Never touches accepted_signature. */
export function buildAcceptPatch(staffName: string, now = new Date()) {
  return { status: "accepted", accepted_at: now.toISOString(), accepted_by: `staff:${(staffName || "staff").trim()}` };
}

export function buildDeclinePatch(now = new Date()) {
  return { status: "declined", declined_at: now.toISOString() };
}

/** Undo restores status + timestamps to what they were before. */
export function buildStatusUndoPatch(prev: QuoteStatusSnapshot) {
  return { status: prev.status, accepted_at: prev.accepted_at, accepted_by: prev.accepted_by, declined_at: prev.declined_at };
}

export function buildSalespersonPatch(userId: string | null) {
  return { sales_engineer_id: userId };
}

export type StatusLogRow = {
  entity_type: "quote";
  entity_id: string;
  field_name: "status" | "sales_engineer_id";
  old_status: string | null;
  new_status: string | null;
  changed_by: string;
  company_id: string;
};

export function buildLogRow(
  quote: { id: string; company_id: string },
  field: StatusLogRow["field_name"],
  oldValue: string | null,
  newValue: string | null,
  changedBy: string,
): StatusLogRow {
  return { entity_type: "quote", entity_id: quote.id, field_name: field, old_status: oldValue, new_status: newValue, changed_by: changedBy, company_id: quote.company_id };
}
