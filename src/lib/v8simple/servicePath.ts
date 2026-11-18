/** Service call-out. R680 excl. VAT per technician visit, its own line, never deducted. A sales site visit is free. A repair quote takes the same deposit percent. */
import { CALL_OUT_EXCL_VAT } from "@/lib/jobTypeChoice";
import { v8DepositAmount, V8_CLIENT_DEPOSIT_PERCENT } from "@/lib/v8simple/clientPay";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface V8ServiceLine { name: string; exclVat: number; ownLine: true }

export function v8ServiceInvoice(visits: { kind: "tech" | "sales" }[], consumablesExcl: number): {
  lines: V8ServiceLine[];
  callOutExclVat: number;
  salesVisitsFree: number;
  deducted: false;
} {
  const techVisits = visits.filter((visit) => visit.kind === "tech").length;
  const callOut = round2(CALL_OUT_EXCL_VAT * techVisits);
  return {
    lines: [
      { name: "Call-out", exclVat: callOut, ownLine: true },
      { name: "Consumables", exclVat: round2(consumablesExcl), ownLine: true },
    ],
    callOutExclVat: callOut,
    salesVisitsFree: visits.filter((visit) => visit.kind === "sales").length,
    deducted: false,
  };
}

export function v8RepairDeposit(total: number) {
  return { percent: V8_CLIENT_DEPOSIT_PERCENT, amount: v8DepositAmount(total, V8_CLIENT_DEPOSIT_PERCENT) };
}
