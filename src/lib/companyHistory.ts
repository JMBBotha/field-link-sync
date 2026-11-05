/** Imported books for one company. Collectible AR is not the whole history. */

export type HistoryInvoice = {
  id: string;
  invoice_number: string | null;
  customer_name: string | null;
  customer_id: string | null;
  status: string | null;
  grand_total: number | string | null;
  issue_date: string | null;
  due_date: string | null;
  archived_at: string | null;
  customer_status: string | null;
  paid: number | string | null;
};

const CLOSED = new Set(["void", "cancelled", "draft"]);

export function invoiceBalanceOf(row: { grand_total?: number | string | null; paid?: number | string | null }): number {
  return Math.max(0, Math.round(((Number(row.grand_total) || 0) - (Number(row.paid) || 0)) * 100) / 100);
}

/**
 * Money still to collect. An individually archived invoice, or an archived client
 * (PGE-style), stays in the history list but is not collectible AR.
 */
export function isCollectibleInvoice(row: HistoryInvoice): boolean {
  if (row.archived_at) return false;
  if ((row.customer_status || "").toLowerCase() === "archived") return false;
  if (CLOSED.has((row.status || "").toLowerCase())) return false;
  return invoiceBalanceOf(row) > 0.005;
}

export function historyTotals(rows: HistoryInvoice[]) {
  let collectible = 0;
  let paid = 0;
  let history = 0;
  for (const row of rows) {
    history += Number(row.grand_total) || 0;
    paid += Number(row.paid) || 0;
    if (isCollectibleInvoice(row)) collectible += invoiceBalanceOf(row);
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { count: rows.length, collectible: r(collectible), paid: r(paid), history: r(history) };
}

/** The company shell's old lists read the empty FreshBooks mirror, not the import. */
export function historyTable(kind: "invoices" | "estimates" | "clients" | "payments", archived: boolean): string {
  if (!archived) {
    return kind === "invoices" ? "company_invoices" : kind === "estimates" ? "fb_estimates" : kind === "clients" ? "fb_contacts" : "fb_payments";
  }
  return kind === "invoices" ? "invoices" : kind === "estimates" ? "quotes" : kind === "clients" ? "customers" : "payments";
}
