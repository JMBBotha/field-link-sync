/** Accounting step 1: payment plans per quote (quotes.payment_plan; null = company deposit % + balance). */
export interface PlanStage { pct: number; label?: string }
export interface PaymentPlan { name: string; stages: PlanStage[] }

export const PLAN_PRESETS: PaymentPlan[] = [
  { name: "70/30", stages: [{ pct: 70, label: "Deposit" }, { pct: 30, label: "Balance on completion" }] },
  { name: "65/35", stages: [{ pct: 65, label: "Deposit" }, { pct: 35, label: "Balance on completion" }] },
  { name: "50/50", stages: [{ pct: 50, label: "Deposit" }, { pct: 50, label: "Balance on completion" }] },
  { name: "20/60/20", stages: [{ pct: 20, label: "Deposit" }, { pct: 60, label: "Progress payment" }, { pct: 20, label: "Balance on completion" }] },
];

/** Mirrors the DB check (payment_plan_ok): 2–4 stages, each 0–100 exclusive, summing to 100. */
export function isValidPlan(p: unknown): p is PaymentPlan {
  const s = (p as PaymentPlan | null)?.stages;
  if (!Array.isArray(s) || s.length < 2 || s.length > 4) return false;
  if (s.some((x) => typeof x?.pct !== "number" || x.pct <= 0 || x.pct >= 100)) return false;
  return Math.abs(s.reduce((a, x) => a + x.pct, 0) - 100) < 1e-9;
}

/** "20% deposit · 60% progress payment · 20% balance on completion" */
export function planSummary(p: PaymentPlan | null | undefined, defaultDepositPct?: number | null): string {
  if (!isValidPlan(p)) {
    const d = Number(defaultDepositPct) || 70;
    return `${d}% deposit · ${100 - d}% balance on completion`;
  }
  return p.stages.map((s, i) => `${s.pct}% ${(s.label || (i === 0 ? "Deposit" : i === p.stages.length - 1 ? "Balance on completion" : "Progress payment")).toLowerCase()}`).join(" · ");
}

/** Terms sentence for the client quote/PDF. */
export function planTermsSentence(p: PaymentPlan | null | undefined, defaultDepositPct: number | null | undefined, termsDays: number | null | undefined): string {
  const days = Number(termsDays) || 30;
  if (!isValidPlan(p)) {
    return `A ${Number(defaultDepositPct) || 70}% deposit is payable on acceptance; the balance is due within ${days} days of completion.`;
  }
  const [first, ...rest] = p.stages;
  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1).map((s) => `${s.pct}% ${(s.label || "progress payment").toLowerCase()}`);
  return `Payments: ${first.pct}% deposit on acceptance${middle.length ? `, ${middle.join(", ")} as the work progresses` : ""}, and the final ${last.pct}% within ${days} days of completion.`;
}

/** Stage number of a stage invoice from its notes ("STAGE 2/3 — …"), else null. */
export function stageOf(notes: string | null | undefined): number | null {
  const m = /^STAGE\s+(\d+)\/(\d+)/.exec(notes || "");
  return m ? Number(m[1]) : null;
}

/** Custom split typed by the user, e.g. "40/40/20" or "30 70". Null unless it is a valid 2–4 stage plan. */
export function parsePlan(text: string): PaymentPlan | null {
  const parts = (text || "").split(/[^\d.]+/).filter(Boolean).map(Number);
  if (parts.length < 2 || parts.length > 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const stages = parts.map((pct, i) => ({
    pct,
    label: i === 0 ? "Deposit" : i === parts.length - 1 ? "Balance on completion" : "Progress payment",
  }));
  const plan = { name: parts.join("/"), stages };
  return isValidPlan(plan) ? plan : null;
}
