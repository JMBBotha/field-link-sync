import type { OpenLeadRow } from "@/lib/yardView";

export type BulkSendLine = {
  id: string;
  customer: string;
  quoteRef: string | null;
  amountLabel: string | null;
  email: string | null;
  phone: string | null;
  quoteId: string | null;
  customerId: string | null;
  /** Why this row will not be emailed. Null when it can be sent. */
  block: string | null;
};

const DRAFT = "draft";

export function isDraftQuote(row: OpenLeadRow): boolean {
  return row.kind === "quote" && !!row.quoteId && String(row.docStatus || "").toLowerCase() === DRAFT;
}

export function markSentSplit(rows: OpenLeadRow[]): { drafts: OpenLeadRow[]; skipped: OpenLeadRow[] } {
  const drafts: OpenLeadRow[] = [];
  const skipped: OpenLeadRow[] = [];
  for (const row of rows) (isDraftQuote(row) ? drafts : skipped).push(row);
  return { drafts, skipped };
}

export function bulkSendLine(row: OpenLeadRow, contact?: { email?: string | null; phone?: string | null }): BulkSendLine {
  const email = (contact?.email || "").trim() || null;
  const phone = (contact?.phone || "").trim() || null;
  let block: string | null = null;
  if (row.kind !== "quote" || !row.quoteId) block = "No quote to send";
  else if (!email && !phone) block = "No email or phone on file";
  else if (!email) block = "No email — sending uses email";
  return {
    id: row.id,
    customer: row.customer,
    quoteRef: row.quoteRef,
    amountLabel: row.amountLabel,
    email,
    phone,
    quoteId: row.quoteId,
    customerId: row.customerId,
    block,
  };
}

export function sendableLines(lines: BulkSendLine[]): BulkSendLine[] {
  return lines.filter((line) => !line.block && !!line.quoteId && !!line.email);
}
