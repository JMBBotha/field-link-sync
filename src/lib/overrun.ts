/**
 * Actual-vs-quoted overrun maths — pure. Staff only (Profit card); techs never see any of it.
 * Extra material cost comes from catalogue cost only; labour overrun uses the company's
 * labour_cost_per_hour, or is excluded ("labour cost not set") exactly like lib/margin.ts.
 */
import { salesShareOn } from "@/lib/margin";

export interface OverrunExtra { product_id?: string | null; name: string; qty: number }
export interface OverrunInput {
  quotedHours: number;
  actualHours: number | null;
  /** Extras with their catalogue unit cost (null = free text / not in catalogue). */
  extras: (OverrunExtra & { unitCost: number | null })[];
  job: { sell: number; gp: number; markupBase?: number };
  labourCostPerHour: number | null;
  salesSharePercent: number;
}
export interface OverrunResult {
  quotedHours: number;
  actualHours: number | null;
  extraHours: number;
  labourCost: number | null;
  labourNotSet: boolean;
  extrasCost: number;
  unknownExtras: number;
  adjustedGp: number;
  adjustedGpPercent: number | null;
  adjustedSalesShare: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeOverrun(i: OverrunInput): OverrunResult {
  const extraHours = i.actualHours == null ? 0 : Math.max(0, r2(i.actualHours - i.quotedHours));
  const rate = i.labourCostPerHour != null && i.labourCostPerHour > 0 ? i.labourCostPerHour : null;
  const labourNotSet = extraHours > 0 && rate == null;
  const labourCost = rate == null ? null : r2(extraHours * rate);
  let extrasCost = 0, unknownExtras = 0;
  for (const e of i.extras) {
    if (e.unitCost == null || !(e.unitCost > 0)) { unknownExtras++; continue; }
    extrasCost += (Number(e.qty) || 0) * e.unitCost;
  }
  extrasCost = r2(extrasCost);
  const adjustedGp = r2(i.job.gp - extrasCost - (labourCost ?? 0));
  return {
    quotedHours: i.quotedHours, actualHours: i.actualHours, extraHours, labourCost, labourNotSet,
    extrasCost, unknownExtras, adjustedGp,
    adjustedGpPercent: i.job.sell > 0 ? r2((adjustedGp / i.job.sell) * 100) : null,
    adjustedSalesShare: salesShareOn((i.job.markupBase ?? i.job.gp) - extrasCost, i.salesSharePercent),
  };
}

/** Parse the jsonb extra_items safely. */
export function parseExtras(v: unknown): OverrunExtra[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x.name === "string").map((x) => ({ product_id: x.product_id ?? null, name: String(x.name), qty: Number(x.qty) || 0 }));
}
