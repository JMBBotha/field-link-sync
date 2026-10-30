import { sumSettled } from "@/lib/payments";
// Shared invoice money maths (paid via sumSettled, same as moneySummary.invoiceMoney). Mirrors DB public._pf_amount_due:
// balance = max(0, grand_total - sum(payments with status paid/succeeded/completed)).
export const PAID_PAYMENT_STATUSES = ["paid", "succeeded", "completed"];
const CLOSED = ["draft", "void", "cancelled", "archived"];

export type MoneyInvoice = { id: string; status?: string | null; grand_total?: number | string | null; archived_at?: string | null };
export type MoneyPayment = { invoice_id: string; amount: number | string | null; status?: string | null };

export function paidByInvoice(payments: MoneyPayment[]): Map<string, number> {
  const by = new Map<string, MoneyPayment[]>();
  for (const p of payments || []) by.set(p.invoice_id, [...(by.get(p.invoice_id) || []), p]);
  return new Map([...by].map(([k, v]) => [k, sumSettled(v as any)]));
}

export function invoiceBalance(inv: MoneyInvoice, paid: Map<string, number>): number {
  return Math.max(0, Math.round(((Number(inv.grand_total) || 0) - (paid.get(inv.id) || 0)) * 100) / 100);
}

/** Summary used by client header + Invoices & Payments chips. Paid counts partial payments. */
export function summarizeInvoices(invoices: MoneyInvoice[], payments: MoneyPayment[], now = new Date()) {
  const paid = paidByInvoice(payments);
  const s = { draft: 0, sent: 0, paid: 0, overdue: 0, outstanding: 0, paidValue: 0, paidInvoices: 0 };
  for (const inv of invoices as any[]) {
    if (inv.archived_at) continue;
    const st = (inv.status || "draft").toLowerCase();
    const got = paid.get(inv.id) || 0;
    if (got > 0 && st !== "void" && st !== "cancelled") { s.paidValue += got; s.paidInvoices++; }
    if (st === "draft") { s.draft++; continue; }
    if (CLOSED.includes(st)) continue;
    const bal = st === "paid" ? 0 : invoiceBalance(inv, paid);
    if (st === "paid" || bal === 0) { s.paid++; continue; }
    s.outstanding += bal;
    if (inv.due_date && new Date(inv.due_date) < now) s.overdue++; else s.sent++;
  }
  s.outstanding = Math.round(s.outstanding * 100) / 100;
  s.paidValue = Math.round(s.paidValue * 100) / 100;
  return s;
}

const JOB_DONE = ["completed", "done", "installed", "complete"];
export type FinalStepJob = { id?: string; status?: string | null; completed_at?: string | null; invoice_id?: string | null };
export type FinalStep = { invoiceId: string; invoiceNumber?: string | null; balance: number; kind: "send_draft" | "send_balance"; jobDone?: boolean };

/**
 * Next step "Send final invoice" (Johan 30 Oct): deposit paid + job completed/installed.
 * Prefers an unsent draft balance invoice; otherwise the deposit invoice whose balance is still open.
 */
export function finalInvoiceStep(invoices: any[], payments: MoneyPayment[], jobs: FinalStepJob[]): FinalStep | null {
  const done = (jobs || []).filter((j) => JOB_DONE.includes((j.status || "").toLowerCase()) || !!j.completed_at);
  // Johan 19:39: final invoice is "ready" once the deposit is paid and a balance is open, even if the job is not marked done yet.
  const paid = paidByInvoice(payments);
  const live = (invoices || []).filter((i) => !i.archived_at && !["void", "cancelled"].includes((i.status || "").toLowerCase()));
  const depositPaid = live.some((i) => (paid.get(i.id) || 0) > 0);
  if (!depositPaid) return null;
  const draft = live.find((i) => (i.status || "draft").toLowerCase() === "draft" && !i.sent_at && (Number(i.grand_total) || 0) > 0);
  if (draft) return { invoiceId: draft.id, invoiceNumber: draft.invoice_number, balance: invoiceBalance(draft, paid), kind: "send_draft", jobDone: done.length > 0 };
  const open = live
    .filter((i) => (paid.get(i.id) || 0) > 0 && invoiceBalance(i, paid) > 0)
    .sort((a, b) => (done.some((j) => j.invoice_id === b.id) ? 1 : 0) - (done.some((j) => j.invoice_id === a.id) ? 1 : 0))[0];
  return open ? { invoiceId: open.id, invoiceNumber: open.invoice_number, balance: invoiceBalance(open, paid), kind: "send_balance", jobDone: done.length > 0 } : null;
}
