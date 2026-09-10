import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import { cn } from "@/lib/utils";

/**
 * Shared deposit-payment chip language.
 * States (identical wording everywhere):
 *  - "Deposit due"       (amber)  — invoice exists, nothing allocated yet
 *  - "Partial · R…"      (amber)  — part-paid, R… is what is still outstanding
 *  - "Deposit paid"      (green)  — fully cleared: status 'paid', paid_date set, or remaining 0
 *  - "No deposit"        (muted)  — accepted work with no invoice row
 */

export interface DepositInvoiceLike {
  id?: string | null;
  status?: string | null;
  paid_date?: string | null;
  grand_total?: number | null;
  amount_paid?: number | null;
  remaining?: number | null;
}

export type DepositChipState = "due" | "partial" | "paid" | "none";

/** Remaining balance on the deposit invoice, when it can be derived. */
export function getDepositRemaining(invoice: DepositInvoiceLike | null | undefined): number | undefined {
  if (!invoice) return undefined;
  if (invoice.remaining !== null && invoice.remaining !== undefined) return Math.max(0, Number(invoice.remaining) || 0);
  if (invoice.amount_paid !== null && invoice.amount_paid !== undefined) {
    return Math.max(0, (Number(invoice.grand_total) || 0) - (Number(invoice.amount_paid) || 0));
  }
  return undefined;
}

/**
 * Fully cleared = invoice allocation only. Requires a KNOWN settled paid sum.
 * Never infer "Deposit paid" from status or paid_date when totals are unknown.
 */
export function isDepositCleared(invoice: DepositInvoiceLike | null | undefined): boolean {
  if (!invoice?.id) return false;
  const remaining = getDepositRemaining(invoice);
  if (remaining === undefined) return false;
  return remaining <= 0;
}

/** Settled cash applied, when known. */
export function getDepositAmountPaid(invoice: DepositInvoiceLike | null | undefined): number | undefined {
  if (!invoice) return undefined;
  if (invoice.amount_paid !== null && invoice.amount_paid !== undefined) {
    return Math.max(0, Number(invoice.amount_paid) || 0);
  }
  if (invoice.remaining !== null && invoice.remaining !== undefined) {
    return Math.max(0, (Number(invoice.grand_total) || 0) - (Number(invoice.remaining) || 0));
  }
  return undefined;
}

export function getDepositChipState(
  invoice: DepositInvoiceLike | null | undefined,
  opts?: { accepted?: boolean },
): DepositChipState | null {
  if (!invoice?.id) return opts?.accepted ? "none" : null;
  // Allocation is the only source of truth. Status/paid_date never decide.
  const paid = getDepositAmountPaid(invoice);
  if (paid === undefined) return "due"; // totals unknown — never claim paid/partial
  const total = Number(invoice.grand_total) || 0;
  const remaining = getDepositRemaining(invoice) ?? Math.max(0, total - paid);
  if (total > 0 && remaining <= 0) return "paid";
  if (paid > 0 && remaining > 0) return "partial";
  return "due";
}

interface DepositPaymentChipProps {
  invoice: DepositInvoiceLike | null | undefined;
  /** Pass true when the quote/work is accepted — renders the muted "No deposit" state when no invoice row exists. */
  accepted?: boolean;
  className?: string;
}

const DepositPaymentChip = ({ invoice, accepted, className }: DepositPaymentChipProps) => {
  const state = getDepositChipState(invoice, { accepted });
  if (!state) return null;

  if (state === "paid") {
    return (
      <Badge
        className={cn(
          "border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
          className,
        )}
      >
        Deposit paid
      </Badge>
    );
  }

  if (state === "partial") {
    // Partial must ALWAYS carry a Rand figure. Prefer the derived remaining,
    // then grand_total - amount_paid, then grand_total as last resort.
    const derived = getDepositRemaining(invoice);
    const total = Number(invoice?.grand_total) || 0;
    const paid = Number(invoice?.amount_paid) || 0;
    const amount = derived !== undefined ? derived : Math.max(0, total - paid);
    return (
      <Badge
        className={cn(
          "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
          className,
        )}
      >
        Partial · {formatRand(amount)}
      </Badge>
    );
  }


  if (state === "due") {
    return (
      <Badge
        className={cn(
          "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
          className,
        )}
      >
        Deposit due
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={cn("border border-border bg-muted text-muted-foreground", className)}>
      No deposit
    </Badge>
  );
};

export default DepositPaymentChip;
