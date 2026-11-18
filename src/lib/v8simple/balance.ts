/** Balance is due the day the job is done. It is quote total minus the deposit, to the cent. A call-out is never subtracted. */
export interface V8BalanceInvoice {
  quoteNo: string;
  total: number;
  dueOn: string;
  callOutExclVat: number;
  status: "due" | "paid";
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function v8BalanceOnJobDone(input: { quoteNo: string; quoteTotal: number; deposit: number; callOutExclVat?: number | null; doneOn: string }): V8BalanceInvoice {
  return {
    quoteNo: input.quoteNo,
    total: round2(input.quoteTotal - input.deposit),
    dueOn: input.doneOn,
    callOutExclVat: round2(input.callOutExclVat ?? 0),
    status: "due",
  };
}

export function v8BalanceReminders(dueOn: string): string[] {
  const [y, m, d] = dueOn.split("-").map(Number);
  return [1, 3, 7].map((add) => {
    const date = new Date(Date.UTC(y, m - 1, d + add));
    return date.toISOString().slice(0, 10);
  });
}

export function v8PayBalance(invoice: V8BalanceInvoice, method: "yoco" | "eft"): V8BalanceInvoice & { closed: boolean; method: "yoco" | "eft" } {
  return { ...invoice, status: "paid", closed: true, method };
}
