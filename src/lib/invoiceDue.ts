/** Invoice due follow-ups (Johan 20 Oct 12:04): final invoices only, steps -3 / due / +3 / +7 / +14. Rows from rpc invoice_due_summary. */
export type DueStep = "pre" | "due" | "plus3" | "plus7" | "plus14" | null;
export type DueRow = {
  invoice_id: string; invoice_number: string | null; customer_id: string | null; customer_name: string | null; customer_email: string | null;
  amount_due: number; due: string; days: number; step: DueStep; rep_id: string | null;
  followup_id: string | null; followup_status: "pending" | "approved" | null; followup_step: string | null; followup_subject: string | null; followup_message: string | null;
  /** Client/invoice payment terms (20 Oct). waiting = completion terms, job not done yet: no due date, no reminders. */
  terms_basis?: "invoice" | "completion" | null; terms_days?: number | null; waiting?: boolean;
};
export type DueTone = "blue" | "amber" | "orange" | "red";
export type DueSummary = {
  total: number; count: number;
  soon: { amount: number; count: number }; today: { amount: number; count: number }; overdue: { amount: number; count: number };
  toApprove: number; urgent: DueRow[]; ownerCalls: DueRow[];
};

export function dueChip(r: Pick<DueRow, "days"> & Partial<Pick<DueRow, "waiting" | "terms_days">>): { label: string; tone: DueTone } {
  if (r.waiting) return { label: `Due ${r.terms_days ?? 30} days after completion`, tone: "blue" };
  const d = r.days;
  if (d < 0) return { label: `Due in ${-d} day${d === -1 ? "" : "s"}`, tone: "blue" };
  if (d === 0) return { label: "Due today", tone: "amber" };
  if (d < 7) return { label: `${d} day${d === 1 ? "" : "s"} late`, tone: "orange" };
  return { label: `${d} days late`, tone: "red" };
}

export const STEP_LABEL: Record<string, string> = {
  pre: "friendly heads-up", due: "polite reminder", plus3: "reminder + call", plus7: "urgent reminder", plus14: "owner to phone", manual: "reminder",
};

export function summarizeDue(rows: DueRow[], soonDays = 7): DueSummary {
  const s: DueSummary = { total: 0, count: 0, soon: { amount: 0, count: 0 }, today: { amount: 0, count: 0 }, overdue: { amount: 0, count: 0 }, toApprove: 0, urgent: [], ownerCalls: [] };
  for (const r of rows) {
    if (r.waiting) continue;
    const a = Number(r.amount_due) || 0;
    s.total += a; s.count += 1;
    if (r.days > 0) { s.overdue.amount += a; s.overdue.count += 1; }
    else if (r.days === 0) { s.today.amount += a; s.today.count += 1; }
    else if (r.days >= -soonDays) { s.soon.amount += a; s.soon.count += 1; }
    if (r.followup_status === "pending") s.toApprove += 1;
    if (r.step === "plus14") s.ownerCalls.push(r);
    else if (r.step === "plus7") s.urgent.push(r);
  }
  s.urgent.sort((a, b) => b.days - a.days); s.ownerCalls.sort((a, b) => b.days - a.days);
  return s;
}

export const randShort = (n: number) => `R ${Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ")}`;

/** Plain-words label for payment terms. */
export function termsLabel(basis?: string | null, days?: number | null): string {
  if (basis === "completion") return `${days ?? 30} days after job completion`;
  if (basis === "invoice") return `${days ?? 7} days after invoice`;
  return "Company default (7 days after invoice)";
}
