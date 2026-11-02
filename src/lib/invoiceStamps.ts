import { isSettledPayment } from "@/lib/payments";

/** Rubber-stamp badges on invoices (Johan 2 Nov): MAILED, DEPOSIT PAID, PAID IN FULL, each with its date. */
export type InvoiceStampKind = "mailed" | "deposit" | "paid";
export interface InvoiceStamp { kind: InvoiceStampKind; label: string; date: string; color: string }

export const STAMP_COLORS: Record<InvoiceStampKind, string> = { mailed: "#3D9BEB", deposit: "#F97316", paid: "#16A34A" };

export interface StampPayment { amount: number | string; payment_date?: string | null; created_at?: string | null; status?: string | null; gateway?: string | null }
export interface StampInvoice { status?: string | null; sent_at?: string | null; grand_total?: number | string | null; deposit_amount?: number | string | null }

const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "");

/**
 * Works the stamps out from existing data only:
 * - MAILED: sent_at (any sent_method, incl. external/manual).
 * - DEPOSIT PAID: date of the settled payment that brought paid-to-date up to the deposit.
 * - PAID IN FULL: date of the settled payment that brought the balance to zero (credit notes count first).
 * Void/cancelled/draft invoices get no stamps.
 */
export function invoiceStamps(inv: StampInvoice, payments: StampPayment[], credited = 0): InvoiceStamp[] {
  const st = String(inv.status || "").toLowerCase();
  if (["void", "cancelled", "draft"].includes(st)) return [];
  const out: InvoiceStamp[] = [];
  if (inv.sent_at) out.push({ kind: "mailed", label: "MAILED", date: day(inv.sent_at), color: STAMP_COLORS.mailed });
  const total = Number(inv.grand_total) || 0;
  const dep = Number(inv.deposit_amount) || 0;
  const settled = payments.filter(isSettledPayment).filter((p) => (Number(p.amount) || 0) > 0)
    .map((p) => ({ a: Number(p.amount) || 0, d: day(p.payment_date || p.created_at), t: String(p.created_at || "") }))
    .filter((p) => p.d)
    .sort((x, y) => (x.d === y.d ? x.t.localeCompare(y.t) : x.d.localeCompare(y.d)));
  let cum = Number(credited) || 0;
  let depIdx = -1, paidIdx = -1;
  settled.forEach((p, i) => {
    cum = Math.round((cum + p.a) * 100) / 100;
    if (dep > 0 && depIdx < 0 && cum >= dep - 0.005) depIdx = i;
    if (total > 0 && paidIdx < 0 && cum >= total - 0.005) paidIdx = i;
  });
  const paidDate = paidIdx >= 0 ? settled[paidIdx].d : "";
  // Deposit is its own event only when it landed before the payment that settled everything.
  if (depIdx >= 0 && (paidIdx < 0 || depIdx < paidIdx)) out.push({ kind: "deposit", label: "DEPOSIT PAID", date: settled[depIdx].d, color: STAMP_COLORS.deposit });
  if (paidDate) out.push({ kind: "paid", label: "PAID IN FULL", date: paidDate, color: STAMP_COLORS.paid });
  return out;
}

export const stampDate = (d: string) => {
  const t = new Date(d + "T00:00:00");
  return isNaN(t.getTime()) ? d : t.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
};
