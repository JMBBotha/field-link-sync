/**
 * Invoice → payment → reconciliation state machine.
 *
 * Invoice statuses: draft → sent → (partially_paid) → paid
 *                              ↘ overdue / cancelled
 * Payment statuses: pending → processing → paid | failed | cancelled | refunded
 *
 * The only way an invoice becomes `paid` is through `reconcileInvoice`, which
 * recomputes the total of *settled* payments for that invoice. That makes the
 * flow idempotent: replaying a webhook cannot double-count a payment.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["processing", "paid", "failed", "cancelled"],
  processing: ["paid", "failed", "cancelled"],
  paid: ["refunded"],
  failed: ["pending", "processing", "paid"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

export interface ReconcileResult {
  invoiceStatus: string;
  paidTotal: number;
  grandTotal: number;
}

/** Recomputes an invoice's status from its settled payments. */
export async function reconcileInvoice(
  db: SupabaseClient,
  invoiceId: string,
): Promise<ReconcileResult | null> {
  const { data: invoice } = await db
    .from("invoices")
    .select("id, grand_total, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return null;

  const { data: payments } = await db
    .from("payments")
    .select("amount, status")
    .eq("invoice_id", invoiceId);

  const paidTotal = (payments ?? [])
    .filter((p: { status: string }) => p.status === "paid")
    .reduce((sum: number, p: { amount: number }) => sum + Number(p.amount || 0), 0);

  const grandTotal = Number(invoice.grand_total || 0);
  const rounded = Math.round(paidTotal * 100) / 100;

  let nextStatus = invoice.status as string;
  if (grandTotal > 0 && rounded + 0.005 >= grandTotal) nextStatus = "paid";
  else if (rounded > 0) nextStatus = "partially_paid";
  else if (invoice.status === "paid" || invoice.status === "partially_paid") {
    nextStatus = "sent";
  }

  if (nextStatus !== invoice.status) {
    await db
      .from("invoices")
      .update({
        status: nextStatus,
        paid_date: nextStatus === "paid"
          ? new Date().toISOString().slice(0, 10)
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);
  }

  return { invoiceStatus: nextStatus, paidTotal: rounded, grandTotal };
}

/** Applies a gateway status to a payment row, respecting allowed transitions. */
export async function applyPaymentStatus(
  db: SupabaseClient,
  paymentId: string,
  nextStatus: PaymentStatus,
  patch: Record<string, unknown> = {},
): Promise<{ applied: boolean; status: PaymentStatus }> {
  const { data: payment } = await db
    .from("payments")
    .select("id, status")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { applied: false, status: nextStatus };

  const current = payment.status as PaymentStatus;
  if (!canTransition(current, nextStatus)) {
    return { applied: false, status: current };
  }

  await db
    .from("payments")
    .update({ ...patch, status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", paymentId);

  return { applied: true, status: nextStatus };
}
