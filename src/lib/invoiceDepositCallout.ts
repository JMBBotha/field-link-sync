import { roundMoney } from "@/lib/amountDueNow";

/**
 * Display model for the invoice "Deposit due" block.
 *
 * The rand amount is the stored invoices.deposit_amount (the trigger writes it
 * from deposit_type / deposit_value; this function never multiplies the
 * percentage back into a new charge). The percentage is the stored
 * deposit_value when the type is percent. On the public invoice link that
 * column is not in the payload, so the percent is read from the note the
 * system already saved ("70% deposit" / "DEPOSIT — 70%"). That label never
 * changes the amount.
 *
 * The split between the deposit and the balance matches amountDueNow: payments
 * apply to the deposit first, and credit notes reduce the balance.
 */
export interface DepositCalloutInput {
  grandTotal?: number | string | null;
  depositAmount?: number | string | null;
  depositType?: string | null;
  depositValue?: number | string | null;
  /** System note, used only to recover a percent the public payload omitted. */
  notes?: string | null;
  amountPaid?: number | string | null;
  credited?: number | string | null;
  status?: string | null;
}

export interface DepositCallout {
  state: "due" | "paid";
  /** Stored deposit request, incl. VAT. */
  depositAmount: number;
  /** Still to collect on that deposit. Equals depositAmount when nothing has been received. */
  depositOutstanding: number;
  /** Settled payments applied to the deposit, capped at the stored deposit. */
  received: number;
  /** Stored percent. Null for a fixed deposit, or when no percent was stored. */
  percent: number | null;
  /** Remainder of the invoice after the deposit, payments and credit notes. */
  balanceRemaining: number;
}

const PERCENT_IN_NOTE = /(\d{1,3}(?:\.\d+)?)\s*%\s*deposit|DEPOSIT\s*[—–-]\s*(\d{1,3}(?:\.\d+)?)\s*%/i;

/** Percent already stored on the invoice. Never derived from the rand amounts. */
export function storedDepositPercent(input: Pick<DepositCalloutInput, "depositType" | "depositValue" | "notes">): number | null {
  if ((input.depositType || "").toLowerCase() !== "percent") return null;
  const value = Number(input.depositValue);
  if (Number.isFinite(value) && value > 0 && value <= 100) return Math.round(value * 100) / 100;
  const match = PERCENT_IN_NOTE.exec(input.notes || "");
  const fromNote = Number(match?.[1] || match?.[2]);
  if (Number.isFinite(fromNote) && fromNote > 0 && fromNote <= 100) return Math.round(fromNote * 100) / 100;
  return null;
}

export function invoiceDepositCallout(input: DepositCalloutInput): DepositCallout | null {
  const status = (input.status || "").toLowerCase();
  if (status === "void" || status === "cancelled") return null;
  if ((input.depositType || "").toLowerCase() === "deposit_invoice") return null;
  const total = roundMoney(input.grandTotal);
  const deposit = roundMoney(input.depositAmount);
  // A deposit request is a part of this invoice. Pay-in-full (no deposit, or the
  // deposit is the whole total) keeps the invoice exactly as it is.
  if (!(deposit > 0.005 && deposit < total - 0.005)) return null;
  const paid = roundMoney(input.amountPaid);
  const credited = roundMoney(input.credited);
  const received = roundMoney(Math.min(Math.max(paid, 0), deposit));
  const depositOutstanding = Math.max(0, roundMoney(deposit - received));
  const finalBase = Math.max(0, roundMoney(total - deposit - credited));
  const balanceRemaining = Math.max(0, roundMoney(finalBase - Math.max(paid - deposit, 0)));
  return {
    state: depositOutstanding <= 0.005 ? "paid" : "due",
    depositAmount: deposit,
    depositOutstanding,
    received,
    percent: storedDepositPercent(input),
    balanceRemaining,
  };
}
