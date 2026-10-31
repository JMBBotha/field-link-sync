/** Balance due ON COMPLETION (Johan 31 Oct 09:57). Pure helpers for the balance block + chips. */
export type BalanceInfo = {
  invoice_id: string; invoice_number: string | null; status: string | null; total: number | null; is_balance: boolean;
  deposit_amount: number; deposit_paid: number; deposit_paid_at: string | null; paid_total: number; balance: number;
  job_id: string | null; job_status: string | null; install_at: string | null; job_done: string | null;
  due: string | null; due_manual: boolean; waiting: boolean; stored_due: string | null; days: number | null;
  terms_basis: string | null; terms_days: number | null; reminder_due: boolean;
  followup_id: string | null; followup_status: string | null; followup_step: string | null;
  can_edit_install: boolean; can_edit_due: boolean; is_admin: boolean;
};

const TZ = "Africa/Johannesburg";
export const fmtDay = (d?: string | null) => {
  if (!d) return "";
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00+02:00`) : new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ });
};
export const fmtDayTime = (d?: string | null) => d ? `${fmtDay(d)} · ${new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })}` : "";
export const rand = (n: number) => `R ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, " ")}`;

/** "Due on completion (installation booked 5 Nov)". Never "due"/"overdue" while waiting. */
export function onCompletionLabel(installAt?: string | null): string {
  return installAt ? `Due on completion (installation booked ${fmtDay(installAt)})` : "Due on completion (installation not booked yet)";
}

export type BalanceTone = "blue" | "green" | "amber" | "red";
export function finalPaymentLine(b: Pick<BalanceInfo, "balance" | "waiting" | "due" | "days" | "install_at" | "due_manual" | "job_done" | "status">): { label: string; tone: BalanceTone } {
  const st = (b.status || "").toLowerCase();
  if (st === "void" || st === "cancelled") return { label: "Void", tone: "blue" };
  if ((Number(b.balance) || 0) <= 0.005) return { label: "Paid in full", tone: "green" };
  if (b.waiting || !b.due) return { label: onCompletionLabel(b.install_at), tone: "blue" };
  const d = b.days ?? 0;
  const why = b.due_manual ? " (set by admin)" : b.job_done ? " (job completed)" : "";
  if (d < 0) return { label: `Due ${fmtDay(b.due)}${why}`, tone: "blue" };
  if (d === 0) return { label: `Due today${why}`, tone: "amber" };
  return { label: `${d} day${d === 1 ? "" : "s"} late · due ${fmtDay(b.due)}${why}`, tone: d >= 2 ? "red" : "amber" };
}

/** datetime-local value (SAST) <-> ISO. */
export const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+02:00`).toISOString() : null);
