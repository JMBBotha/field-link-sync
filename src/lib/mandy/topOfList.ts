import type { MandyResult } from "@/lib/mandy/actions";

/** Legacy proposal rows open the one orange builder (keeping the client); the old ProposalBuilder is retired. */
export function legacyProposalRoute(row: { raw?: { client_id?: string | null } | null }): string {
  const c = row.raw?.client_id;
  return c ? `/admin/quote-builder?customerId=${c}` : "/admin/quote-builder";
}

/** Open the first row of the list exactly as rendered (current sort + filters). */
export function topOfListResult<T extends { id: string; ref?: string | null; clientName?: string | null; kind?: string; raw?: { client_id?: string | null } | null }>(rows: T[], open: (row: T) => void): MandyResult {
  const top = rows[0];
  if (!top) return { ok: false, message: "The list is empty with the current filters." };
  open(top);
  const route = top.kind === "proposal" ? legacyProposalRoute(top) : `/admin/estimates/${top.id}`;
  return { ok: true, message: `Opened ${top.ref || "the top quote"}${top.clientName ? ` for ${top.clientName}` : ""}.`, data: { quote_id: top.id, route } };
}
