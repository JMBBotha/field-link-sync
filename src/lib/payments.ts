import { supabase } from "@/integrations/supabase/client";

/**
 * Payment allocation SoT (Johan 2026-09-10).
 * - `invoices.grand_total` = money owed
 * - `payments` rows with `invoice_id` = cash applied
 * - Invoice status is DERIVED by the `recalc_invoice_status` trigger from
 *   SETTLED payments only. The UI never writes status='paid' directly.
 */

/** Payment statuses that count as cash actually applied to an invoice. */
export const SETTLED_PAYMENT_STATUSES = ["paid", "succeeded"] as const;

export type PaymentMethod = "cash" | "eft" | "card" | "other";

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number | string;
  method: string;
  reference?: string | null;
  payment_date: string;
  status?: string | null;
  gateway?: string | null;
  created_at?: string;
}

export const isSettledPayment = (p: { status?: string | null; gateway?: string | null }) =>
  (p.status != null && (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(p.status)) ||
  (p.status == null && p.gateway === "manual");

/** Sum of settled payments (2dp). */
export const sumSettled = (payments: Array<{ amount: number | string; status?: string | null; gateway?: string | null }>) =>
  Math.round(
    payments.filter(isSettledPayment).reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100,
  ) / 100;

export const invoiceBalance = (grandTotal: number | string | null | undefined, amountPaid: number) =>
  Math.max(0, Math.round(((Number(grandTotal) || 0) - amountPaid) * 100) / 100);

export interface RecordPaymentInput {
  invoiceId: string;
  amount: number;
  method: PaymentMethod | string;
  reference?: string | null;
  /** YYYY-MM-DD; defaults to today on the server. */
  paymentDate?: string | null;
}

/**
 * Record cash applied to an invoice. Goes through the `record_invoice_payment`
 * RPC so the row is written as a settled (status=paid) manual payment and the invoice
 * status is derived by the DB trigger. Returns the new payment id.
 */
export async function recordInvoicePayment(input: RecordPaymentInput): Promise<string> {
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: input.invoiceId,
    p_amount: amount,
    p_method: input.method,
    p_reference: input.reference || null,
    ...(input.paymentDate ? { p_payment_date: input.paymentDate } : {}),
  } as any);
  if (error) throw error;
  return data as unknown as string;
}
