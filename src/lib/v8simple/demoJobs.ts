/** Example rows for the V8 jobs list. Not live clients. */
import type { HomeInvoice } from "@/lib/adminHomeCount";
import type { V8EftPending, V8JobRow } from "@/lib/v8simple/jobs";

export const V8_DEMO_COMPANY = "00000000-0000-4000-8000-0000000000aa";

export const V8_DEMO_JOBS: V8JobRow[] = [
  { id: "lead-1", client: "Demo client A", area: "Claremont", work: "Installation", input: {} },
  { id: "visit-1", client: "Demo client B", area: "Observatory", work: "Installation", input: { visitBooked: true } },
  { id: "quote-1", client: "Demo client C", area: "Sea Point", work: "Installation", quoteNo: "Q-1042", input: { quoteStatus: "sent", quoteSentAt: "2026-11-12" } },
  { id: "dep-1", client: "Demo client D", area: "Wynberg", work: "Installation", quoteNo: "Q-1048", input: { quoteStatus: "accepted", depositPaid: false, depositRemaining: 8000, quoteTotal: 14000 } },
  { id: "ready-1", client: "Demo client E", area: "Southern suburbs", work: "Installation", quoteNo: "Q-1102", input: { quoteStatus: "accepted", depositPaid: true, depositRemaining: 0, techId: null } },
  { id: "site-1", client: "Demo client F", area: "Gardens", work: "Installation", quoteNo: "Q-1110", input: { quoteStatus: "accepted", depositPaid: true, depositRemaining: 0, techId: "tech-1", startedAt: "2026-11-17T09:00:00+02:00" } },
  { id: "bal-1", client: "Demo client G", area: "Rondebosch", work: "Installation", quoteNo: "Q-1088", input: { quoteStatus: "accepted", depositPaid: true, techId: "tech-2", completedAt: "2026-11-16T16:00:00+02:00", balanceRemaining: 22000 } },
  { id: "paid-1", client: "Demo client H", area: "Pinelands", work: "Installation", quoteNo: "Q-1004", input: { quoteStatus: "accepted", depositPaid: true, completedAt: "2026-11-10T15:00:00+02:00", balanceRemaining: 0, paid: true } },
  { id: "svc-1", client: "Demo client I", area: "Woodstock", work: "Service call-out", input: { kind: "service", visitBooked: true, callOutExclVat: 680 } },
  { id: "lost-1", client: "Demo client J", area: "Claremont", work: "Installation", input: { quoteStatus: "declined" } },
];

export const V8_DEMO_INVOICES: HomeInvoice[] = [
  {
    id: "dep", company_id: V8_DEMO_COMPANY, status: "sent", sent_at: "2026-11-14", grand_total: 8000,
    notes: "DEPOSIT", invoice_number: "DEMO-D1", customer_name: "Demo client D", quote_id: "q-d",
  },
  {
    id: "fin", company_id: V8_DEMO_COMPANY, status: "sent", sent_at: "2026-11-16", grand_total: 22000,
    notes: "Final", invoice_number: "DEMO-F1", customer_name: "Demo client G", quote_id: "q-g",
  },
];

export const V8_DEMO_EFT: V8EftPending[] = [
  { id: "eft-1", amount: 4500, reference: "Q-1042", client: "Demo client C" },
];

/** Incoming FNB lines in the bank_lines shape. One matches Q-1048 to the cent. One does not. */
export const V8_DEMO_FNB_LINES = [
  { id: "fnb-ok", amount: 9800, reference: "Q-1048", description: "AC deposit", txnDate: "2026-11-17", status: "new" as const, origin: "csv_pdf_import" },
  { id: "fnb-short", amount: 1000, reference: "Q-1042", description: "part", txnDate: "2026-11-17", status: "new" as const, origin: "csv_pdf_import" },
];

export const V8_DEMO_EFT_EXPECTS = [
  { id: "dep-1", quoteNo: "Q-1048", invoiceNo: "DEMO-D1", amount: 9800, client: "Demo client D" },
  { id: "quote-1", quoteNo: "Q-1042", invoiceNo: "DEMO-Q", amount: 4500, client: "Demo client C" },
];
