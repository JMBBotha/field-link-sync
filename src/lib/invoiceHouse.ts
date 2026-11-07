// House / site label for project (estate) invoices, so the house is the first thing you read (Johan 3 Nov).
// Source of truth: invoices.project_house_id -> project_houses.house_no. Fallback for unlinked invoices:
// a "HOUSE 12" tag in the first line item or the first line of the notes. Display only; never touches totals.
export const HOUSE_EMBED = "project_house:project_houses(id, house_no, project_id, project:projects(name))";

export interface HouseSource {
  project_house?: { id?: string | null; house_no?: string | null; project_id?: string | null; project?: { name?: string | null } | null } | null;
  notes?: string | null;
  line_items?: unknown;
}

const TAG = /\bHOUSE\s*(?:NO\.?|#)?\s*([0-9]{1,4}[A-Z]?)\b/i;

function firstLineDesc(items: unknown): string {
  const arr = Array.isArray(items) ? items : [];
  const it = arr[0] as { description?: string; line_name?: string } | undefined;
  return [it?.line_name, it?.description].filter(Boolean).join(" ");
}

/** House number for an invoice, or null when it isn't for a project house. */
export function invoiceHouseNo(inv: HouseSource | null | undefined): string | null {
  if (!inv) return null;
  const linked = inv.project_house?.house_no?.trim();
  if (linked) return linked;
  const m = TAG.exec(firstLineDesc(inv.line_items)) || TAG.exec((inv.notes || "").split("\n")[0] || "");
  return m ? m[1].toUpperCase() : null;
}

/** "House 12" (plus " · Project" when known), or null. */
export function invoiceHouseLabel(inv: HouseSource | null | undefined, withProject = false): string | null {
  const no = invoiceHouseNo(inv);
  if (!no) return null;
  const proj = withProject ? inv?.project_house?.project?.name?.trim() : "";
  return proj ? `House ${no} · ${proj}` : `House ${no}`;
}

/** "House 12" only when the invoice is linked to project_houses.house_no.
 *  Notes and line items are ignored, so an ordinary client is never given a guessed house. */
export function linkedInvoiceHouseLabel(inv: HouseSource | null | undefined): string | null {
  if (!inv?.project_house?.house_no?.trim()) return null;
  return invoiceHouseLabel({ project_house: inv.project_house });
}

/** Search on client name, invoice number or house ("12", "house 12", "h12"). */
export function invoiceMatchesSearch(inv: HouseSource & { customer_name?: string | null; invoice_number?: string | null }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if ((inv.customer_name || "").toLowerCase().includes(s) || (inv.invoice_number || "").toLowerCase().includes(s)) return true;
  const no = invoiceHouseNo(inv)?.toLowerCase();
  if (!no) return false;
  const bare = s.replace(/^(house|h)\s*(no\.?|#)?\s*/, "");
  return bare === no || `house ${no}`.startsWith(s);
}

/** Link to the project house for a linked invoice (opens the house drawer), or null. */
export function invoiceHouseHref(inv: HouseSource | null | undefined): string | null {
  const h = inv?.project_house;
  return h?.id && h.project_id ? `/admin/projects/${encodeURIComponent(h.project_id)}?house=${encodeURIComponent(h.id)}` : null;
}
