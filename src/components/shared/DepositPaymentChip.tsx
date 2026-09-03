import { Badge } from "@/components/ui/badge";
import { formatRand } from "@/utils/formatRand";
import { cn } from "@/lib/utils";

/**
 * Shared deposit-payment chip language.
 * States (identical wording everywhere):
 *  - "Deposit due · R…" (amber)  — invoice exists, not paid/cleared
 *  - "Deposit paid"      (green)  — status paid / partially_paid / paid_date set
 *  - "No deposit"        (muted)  — accepted work with no invoice row
 */

export interface DepositInvoiceLike {
  id?: string | null;
  status?: string | null;
  paid_date?: string | null;
  grand_total?: number | null;
}

export type DepositChipState = "due" | "paid" | "none";

/** Statuses treated as cleared per existing payment UX (partially_paid counts as paid). */
const PAID_STATUSES = new Set(["paid", "partially_paid"]);

export function getDepositChipState(
  invoice: DepositInvoiceLike | null | undefined,
  opts?: { accepted?: boolean },
): DepositChipState | null {
  if (!invoice?.id) return opts?.accepted ? "none" : null;
  const status = String(invoice.status || "").toLowerCase();
  if (PAID_STATUSES.has(status) || invoice.paid_date) return "paid";
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

  if (state === "due") {
    const amount = Number(invoice?.grand_total) || 0;
    return (
      <Badge
        className={cn(
          "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
          className,
        )}
      >
        Deposit due{amount > 0 ? ` · ${formatRand(amount)}` : ""}
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
