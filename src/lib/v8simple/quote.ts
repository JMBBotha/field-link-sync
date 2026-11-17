/** One discount on a quote, at most 15%. Deposit follows the company percent. */
export const V8_MAX_DISCOUNT_PERCENT = 15;
export const V8_DEMO_DEPOSIT_PERCENT = 70;

export type V8QuoteKind = "unit" | "material" | "labour" | "extra";
export interface V8QuoteLine { name: string; kind: V8QuoteKind; qty: number; amount: number }

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function v8ApplyDiscount(
  currentPercent: number | null,
  nextPercent: number,
): { ok: true; percent: number } | { ok: false; reason: string } {
  if (currentPercent != null && currentPercent > 0) return { ok: false, reason: "A quote can have one discount." };
  if (!Number.isFinite(nextPercent)) return { ok: false, reason: "Enter a discount percent." };
  if (nextPercent < 0) return { ok: false, reason: "Discount cannot be negative." };
  if (nextPercent > V8_MAX_DISCOUNT_PERCENT) return { ok: false, reason: "Discount cannot be more than 15%." };
  return { ok: true, percent: nextPercent };
}

export function v8QuoteTotals(lines: { amount: number }[], discountPercent: number, depositPercent: number) {
  const subtotal = round2(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));
  const discount = round2(subtotal * (Number(discountPercent) || 0) / 100);
  const total = round2(subtotal - discount);
  const deposit = round2(total * (Number(depositPercent) || 0) / 100);
  return { subtotal, discount, total, deposit, balance: round2(total - deposit) };
}

/** Units and materials only. Labour is not a pack item. */
export function v8PackList(lines: V8QuoteLine[]): V8QuoteLine[] {
  return lines.filter((line) => line.kind === "unit" || line.kind === "material");
}

export const V8_QUOTE_OPTIONS: { id: string; label: string; lines: V8QuoteLine[] }[] = [
  {
    id: "good",
    label: "Good",
    lines: [
      { name: "9 000 BTU midwall", kind: "unit", qty: 1, amount: 8900 },
      { name: "Copper pipe", kind: "material", qty: 6, amount: 720 },
      { name: "Install labour", kind: "labour", qty: 1, amount: 1800 },
    ],
  },
  {
    id: "better",
    label: "Better",
    lines: [
      { name: "12 000 BTU midwall", kind: "unit", qty: 1, amount: 11200 },
      { name: "Copper pipe", kind: "material", qty: 8, amount: 960 },
      { name: "Wall bracket", kind: "material", qty: 1, amount: 280 },
      { name: "Install labour", kind: "labour", qty: 1, amount: 2100 },
    ],
  },
  {
    id: "best",
    label: "Best",
    lines: [
      { name: "18 000 BTU midwall", kind: "unit", qty: 1, amount: 14600 },
      { name: "Copper pipe", kind: "material", qty: 10, amount: 1200 },
      { name: "Wall bracket", kind: "material", qty: 1, amount: 280 },
      { name: "Trunking", kind: "material", qty: 3, amount: 540 },
      { name: "Install labour", kind: "labour", qty: 1, amount: 2400 },
    ],
  },
];
