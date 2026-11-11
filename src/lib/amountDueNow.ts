/**
 * What the client should pay today, on one full-value invoice that has a deposit stage.
 *
 * A deposit is due on send unless an explicit expected deposit date is still in the future.
 * The terms clock is not a deposit date. The remainder is due only when it has a real date:
 * the expected final date, a hand-set due date, or the day the job is completed.
 * A terms-only due date does not make the balance payable now.
 * Already-issued invoice amounts are never an input this function writes back.
 */
export interface DueNowInput {
  grandTotal: number;
  amountPaid?: number | null;
  credited?: number | null;
  depositAmount?: number | null;
  depositType?: string | null;
  status?: string | null;
  /** YYYY-MM-DD. Null means the deposit is due when the invoice is sent. */
  expectedDepositDate?: string | null;
  expectedFinalDate?: string | null;
  dueDate?: string | null;
  dueDateManual?: boolean | null;
  /** YYYY-MM-DD the installation was completed, or null while the job is still open. */
  jobDone?: string | null;
  /** YYYY-MM-DD in Africa/Johannesburg. */
  today: string;
}

export interface DueNow {
  dueNow: number;
  later: number;
  depositStage: boolean;
}

export const roundMoney = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : null);

export function amountDueNow(input: DueNowInput): DueNow {
  const status = (input.status || "").toLowerCase();
  if (status === "void" || status === "cancelled" || status === "paid") {
    return { dueNow: 0, later: 0, depositStage: false };
  }
  const total = roundMoney(input.grandTotal);
  const paid = roundMoney(input.amountPaid);
  const credited = roundMoney(input.credited);
  const deposit = roundMoney(input.depositAmount);
  const depositStage = deposit > 0.005 && deposit < total - 0.005 && (input.depositType || "") !== "deposit_invoice";
  if (!depositStage) {
    return { dueNow: Math.max(0, roundMoney(total - paid - credited)), later: 0, depositStage: false };
  }
  const depositOutstanding = Math.max(0, roundMoney(deposit - Math.min(paid, deposit)));
  const finalBase = Math.max(0, roundMoney(total - deposit - credited));
  const finalOutstanding = Math.max(0, roundMoney(finalBase - Math.max(paid - deposit, 0)));
  const depositDate = day(input.expectedDepositDate);
  let dueNow = 0;
  if (!depositDate || depositDate <= input.today) dueNow += depositOutstanding;
  const finalDate = day(input.expectedFinalDate)
    || (input.dueDateManual ? day(input.dueDate) : null)
    || day(input.jobDone);
  if (finalDate && finalDate <= input.today) dueNow += finalOutstanding;
  dueNow = roundMoney(dueNow);
  const remaining = roundMoney(depositOutstanding + finalOutstanding);
  return { dueNow, later: Math.max(0, roundMoney(remaining - dueNow)), depositStage: true };
}

/** Johannesburg calendar day for the client invoice page. */
export function johannesburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
