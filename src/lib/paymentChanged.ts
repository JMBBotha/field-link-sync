import type { QueryClient } from "@tanstack/react-query";

export const PAYMENT_CHANGED_EVENT = "fl:payment-changed";

/**
 * A payment was added, edited or removed (Johan 3 Nov 07:10): every screen showing money for that
 * client must update straight away — home tiles (Invoices waiting, Collected/Outstanding), client strip,
 * invoice Balance block, invoice lists, pipeline/job cards and stamps. Those read many different query
 * keys, so mark ALL queries stale (only mounted ones refetch now; the rest refetch when next shown)
 * and broadcast an event for any non-react-query listeners.
 */
export function notifyPaymentChanged(qc: QueryClient, invoiceId: string) {
  void qc.invalidateQueries();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PAYMENT_CHANGED_EVENT, { detail: { invoiceId } }));
}

/** Same amount on the same invoice recorded in the last few minutes (or on the same payment date). */
export function findLikelyDuplicate(payments: Array<{ amount: unknown; payment_date?: unknown; created_at?: unknown; status?: unknown; _optimistic?: boolean }>,
  amount: number, paymentDate: string, now = Date.now(), windowMin = 10) {
  return payments.find((p) => {
    if (p._optimistic || ["failed", "cancelled"].includes(String(p.status || ""))) return false;
    if (Math.abs(Number(p.amount) - amount) >= 0.005) return false;
    const recent = p.created_at ? now - new Date(String(p.created_at)).getTime() < windowMin * 60_000 : false;
    return recent || String(p.payment_date || "").slice(0, 10) === paymentDate;
  }) || null;
}
