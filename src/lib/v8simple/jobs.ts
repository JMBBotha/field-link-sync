/** Jobs list helpers. Stages come from v8Stage. Money totals come from countAdminHome. */
import { countAdminHome, type AdminHomeCounts, type HomeInvoice } from "@/lib/adminHomeCount";
import { v8Stage, V8_INSTALL_STAGES, V8_SERVICE_STAGES, type V8Stage, type V8StageInput, type V8StageKey } from "@/lib/v8simple/stage";

export interface V8JobRow {
  id: string;
  client: string;
  area: string;
  work: string;
  quoteNo?: string | null;
  input: V8StageInput;
}

export interface V8EftPending {
  id: string;
  amount: number;
  reference: string;
  client: string;
}

export function v8JobStage(row: V8JobRow): V8Stage {
  return v8Stage(row.input);
}

export function v8ActiveJobs(rows: V8JobRow[]): V8JobRow[] {
  return rows.filter((row) => v8JobStage(row).active);
}

/** Pill counts. Each count is the number of active rows whose stage key matches. */
export function v8JobCounts(rows: V8JobRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of [...V8_INSTALL_STAGES, ...V8_SERVICE_STAGES]) counts[stage.key] = 0;
  for (const row of v8ActiveJobs(rows)) {
    const key = v8JobStage(row).key;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function v8FilterJobs(rows: V8JobRow[], stage: string | null, money: boolean): V8JobRow[] {
  const active = v8ActiveJobs(rows);
  if (money) return active.filter((row) => ["deposit_due", "balance_due", "pay_due"].includes(v8JobStage(row).key));
  if (!stage || stage === "all") return active;
  return active.filter((row) => v8JobStage(row).key === stage);
}

export const V8_JOB_PILLS: { key: V8StageKey | "booked" | "pay_due"; label: string }[] = [
  ...V8_INSTALL_STAGES.map((s) => ({ key: s.key, label: s.label })),
  { key: "booked", label: "Booked" },
  { key: "pay_due", label: "Pay due" },
];

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Deposit due and balance due are the admin home figures. EFT to match is listed beside them. */
export function v8MoneyView(
  input: { companyId: string; now?: Date; invoices?: HomeInvoice[] },
  eft: V8EftPending[] = [],
): { depositDue: number; balanceDue: number; eftToMatch: number; home: AdminHomeCounts } {
  const home = countAdminHome(input);
  return {
    depositDue: home.deposit.total,
    balanceDue: home.finalDue.total,
    eftToMatch: round2(eft.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    home,
  };
}

export function v8Rand(n: number): string {
  const rounded = Math.round(Number(n) || 0);
  const sign = rounded < 0 ? "-" : "";
  const body = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R${body}`;
}
