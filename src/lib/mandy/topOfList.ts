import type { MandyResult } from "@/lib/mandy/actions";

/** Open the first row of the list exactly as rendered (current sort + filters). */
export function topOfListResult<T extends { id: string; ref?: string | null; clientName?: string | null; kind?: string }>(rows: T[], open: (row: T) => void): MandyResult {
  const top = rows[0];
  if (!top) return { ok: false, message: "The list is empty with the current filters." };
  open(top);
  const route = top.kind === "proposal" ? "/admin/quote-builder" : `/admin/quote-builder?quoteId=${top.id}`;
  return { ok: true, message: `Opened ${top.ref || "the top quote"}${top.clientName ? ` for ${top.clientName}` : ""}.`, data: { quote_id: top.id, route } };
}
