// Sales "Next steps" (Johan 31 Oct 2026). Rows come from the sales_next_steps() RPC; this file holds labels and grouping only.
export type NextStepRule =
  | "new_lead" | "no_quote" | "followup" | "cold" | "deposit_invoice" | "book_install" | "assign_tech" | "final_invoice" | "final_unpaid";

export type NextStep = {
  rule: NextStepRule; prio: number; entity_type: string; entity_id: string; title: string; detail: string | null;
  amount: number | null; since: string | null; owner_id: string | null; link: string; snoozable: boolean;
};

export const RULES: Record<NextStepRule, { chip: (n: number) => string; action: string; tone: "red" | "orange" | "blue" }> = {
  new_lead: { chip: (n) => `${n} new lead${n === 1 ? "" : "s"}`, action: "Open lead", tone: "red" },
  no_quote: { chip: (n) => `${n} quote${n === 1 ? "" : "s"} to send`, action: "Start quote", tone: "orange" },
  followup: { chip: (n) => `${n} follow-up${n === 1 ? "" : "s"}`, action: "Follow up", tone: "orange" },
  cold: { chip: (n) => `${n} cold quote${n === 1 ? "" : "s"}`, action: "Follow up now", tone: "orange" },
  deposit_invoice: { chip: (n) => `${n} deposit invoice${n === 1 ? "" : "s"}`, action: "Send invoice", tone: "orange" },
  book_install: { chip: (n) => `${n} install date${n === 1 ? "" : "s"}`, action: "Book installation", tone: "blue" },
  assign_tech: { chip: (n) => `${n} need${n === 1 ? "s" : ""} a technician`, action: "Assign technician", tone: "blue" },
  final_invoice: { chip: (n) => `${n} final invoice${n === 1 ? "" : "s"}`, action: "Send final invoice", tone: "blue" },
  final_unpaid: { chip: (n) => `${n} final unpaid`, action: "Send reminder", tone: "blue" },
};

export const RULE_ORDER = Object.keys(RULES) as NextStepRule[];

export function countByRule(rows: NextStep[]): { rule: NextStepRule; n: number }[] {
  const m = new Map<NextStepRule, number>();
  rows.forEach((r) => m.set(r.rule, (m.get(r.rule) || 0) + 1));
  return RULE_ORDER.filter((r) => m.has(r)).map((rule) => ({ rule, n: m.get(rule)! }));
}

/** Stable order: rule priority, then oldest first. */
export function sortSteps(rows: NextStep[]): NextStep[] {
  return [...rows].sort((a, b) => a.prio - b.prio || String(a.since ?? "9").localeCompare(String(b.since ?? "9")));
}

export function minutesWaiting(since: string | null, now = Date.now()): number | null {
  if (!since) return null;
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
}

export function waitingLabel(mins: number | null): string {
  if (mins == null) return "";
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} days`;
}
