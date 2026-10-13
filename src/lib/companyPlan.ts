/** Company plan maths (Johan 13 Oct 2026). Same rule as plan_admin_overview() in the database. */
export const PLAN_DEFAULTS = { base: 4500, included: 3, extra: 149, months: 36, graceDays: 7 } as const;
export function planMonthlyZar(users: number, base: number = PLAN_DEFAULTS.base, included: number = PLAN_DEFAULTS.included, extra: number = PLAN_DEFAULTS.extra): number {
  return base + Math.max(0, Math.floor(users || 0) - included) * extra;
}
export const CONTRACT_VERSION = "2026-10-13";
export function contractTerms(p: { base: number; included: number; extra: number; months: number }): string[] {
  const r = (n: number) => `R${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 }).replace(/[,\u00a0\u202f]/g, " ")}`;
  return [
    `Field Lynk subscription for ${p.months} months from today.`,
    `${r(p.base)} per month (excl. VAT), flat, for up to ${p.included} users. The in-app work assistant is included.`,
    `${r(p.extra)} per month for each extra user.`,
    `If a payment is missed there is a ${PLAN_DEFAULTS.graceDays}-day grace period, after which the account is paused until it's settled.`,
    "Pricing, the product catalogue and terms are set by Massair for every company in the network.",
    "Billing has not started yet. You'll be told before the first invoice.",
  ];
}
