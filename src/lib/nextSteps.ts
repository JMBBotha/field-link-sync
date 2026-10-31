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

export type Urgency = "green" | "orange" | "red";
const H = 3600000, D = 24 * H, M = 60000;
/** Time-urgency thresholds per rule (Johan 31 Oct 10:44): [orange from, red from], measured from `since`. */
export const URGENCY: Record<NextStepRule, { orange: number; red: number; note: string }> = {
  new_lead: { orange: 2 * M, red: 5 * M, note: "0-2 min green, 2-5 min orange, 5+ min red" },
  no_quote: { orange: 1 * D, red: 2 * D, note: "visit day green, day 1-2 orange, 2+ days red" },
  followup: { orange: 5 * D, red: 7 * D, note: "sent 0-5 days green, 5-7 orange, 7+ red" },
  cold: { orange: 0, red: 20 * D, note: "Cold is orange; red in the last 10 days before archive (50+ days)" },
  deposit_invoice: { orange: 4 * H, red: 1 * D, note: "accepted 0-4 h green, 4-24 h orange, 1+ day red" },
  book_install: { orange: 2 * D, red: 3 * D, note: "deposit paid 0-2 days green, 2-3 orange, 3+ red" },
  assign_tech: { orange: -3 * D, red: -1 * D, note: "install 3+ days away green, 1-3 days orange, under 1 day red" },
  final_invoice: { orange: 1 * D, red: 2 * D, note: "completion day green, day 1 orange, 2+ days red" },
  final_unpaid: { orange: 0, red: 0, note: "always red (already 2 days after completion)" },
};
export function urgency(row: Pick<NextStep, "rule" | "since">, now = Date.now()): Urgency {
  const t = URGENCY[row.rule];
  if (!row.since) return "green";
  const age = now - new Date(row.since).getTime();
  return age >= t.red ? "red" : age >= t.orange ? "orange" : "green";
}
const RANK: Record<Urgency, number> = { red: 0, orange: 1, green: 2 };
export function worstUrgency(rows: NextStep[], now = Date.now()): Urgency {
  return rows.reduce<Urgency>((w, r) => (RANK[urgency(r, now)] < RANK[w] ? urgency(r, now) : w), "green");
}
