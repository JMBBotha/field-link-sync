/**
 * Office payment recording. The database is the real guard (record_invoice_payment).
 * These sentences are the same ones the RPC raises, so the form and the server agree.
 */
export const PAYMENT_OVERPAY_MESSAGE = "This payment is more than the amount still outstanding. It was not recorded.";
export const PAYMENT_DUPLICATE_MESSAGE = "A payment with this reference is already on this invoice. It was not recorded again.";

export function paymentOverOutstanding(amount: number, outstanding: number): boolean {
  return Math.round(amount * 100) > Math.round(outstanding * 100) + 1;
}

export function duplicatePaymentReference(
  payments: Array<{ reference?: string | null; status?: string | null; gateway?: string | null }>,
  reference: string,
  settled: (row: { status?: string | null; gateway?: string | null }) => boolean,
): boolean {
  const key = reference.trim().toLowerCase();
  if (!key) return false;
  return payments.some((p) => settled(p) && String(p.reference || "").trim().toLowerCase() === key);
}
