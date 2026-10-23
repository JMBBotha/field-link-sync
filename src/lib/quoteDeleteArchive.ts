// Admin "Delete quote" / "Archive quote" — pure helpers (server decides; this only shapes the UI).

export type DeleteCheck = {
  can_delete: boolean;
  reasons: string[];
  counts: Record<string, number>;
  photos_optional: boolean;
  quote_id: string;
  quote_number: string | null;
  status: string | null;
  archived: boolean;
  archived_at?: string | null;
  archive_reason?: string | null;
};

export type ArchivableQuote = { id: string; quote_number?: string | null; archived_at?: string | null };

/** What the admin must type to confirm a hard delete: the quote number, or DELETE when the quote has none. */
export const confirmWord = (q: { quote_number?: string | null }) => (q.quote_number || "").trim() || "DELETE";

export const confirmMatches = (typed: string, q: { quote_number?: string | null }) =>
  typed.trim().toUpperCase() === confirmWord(q).toUpperCase();

export const reasonOk = (r: string) => r.trim().length >= 3;

const LABELS: [key: string, one: string, many: string][] = [
  ["items", "line item", "line items"],
  ["line_items", "legacy line item", "legacy line items"],
  ["areas", "area", "areas"],
  ["versions", "saved version", "saved versions"],
  ["attachments", "photo on the quote", "photos on the quote"],
  ["documents", "attached document", "attached documents"],
  ["draft_invoices", "draft invoice (never sent)", "draft invoices (never sent)"],
  ["send_approvals", "pending invoice send", "pending invoice sends"],
  ["notifications", "alert", "alerts"],
  ["followups", "follow-up log entry", "follow-up log entries"],
  ["email_sends", "email send record", "email send records"],
  ["change_requests", "client change request", "client change requests"],
];

/** Human list of what a hard delete removes (zero counts left out). */
export const deletionLines = (counts: Record<string, number> | undefined): string[] =>
  LABELS.flatMap(([k, one, many]) => {
    const n = Number(counts?.[k] || 0);
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  });

/** Which menu entries an admin sees. Non-admins see none (server enforces the same). */
export const deleteArchiveMenu = (q: ArchivableQuote, isAdmin: boolean) => ({
  del: isAdmin && !q.archived_at,
  archive: isAdmin && !q.archived_at,
  unarchive: isAdmin && !!q.archived_at,
});
