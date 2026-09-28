/**
 * Sales margin maths — pure. Reads what lines already store; never reprices.
 * GP = sell ex VAT − cost. Discount lowers sell at job level, pro-rata to areas.
 */
export interface MarginLineInput {
  id: string;
  name: string;
  areaId: string | null;
  qty: number;
  unitPrice: number;
  /** Stored unit cost; null = unknown (never treated as R0). */
  unitCost: number | null;
  isLabour: boolean;
  isService: boolean;
}

export interface MarginSettings {
  labourCostPerHour: number | null;
  gpTargetPercent: number;
  commissionPercent: number;
  labourTechSharePercent: number;
}

export type LineStatus = "ok" | "cost_unknown" | "labour_cost_not_set";

export interface MarginLine {
  id: string; name: string; areaId: string | null;
  sell: number; cost: number | null; gp: number | null; gpPercent: number | null; status: LineStatus;
}

export interface MarginRollup { sell: number; cost: number; gp: number; gpPercent: number | null }

export interface MarginResult {
  lines: MarginLine[];
  areas: Record<string, MarginRollup>;
  job: MarginRollup & { discount: number; grossSell: number };
  unknownCostCount: number;
  labourExcluded: boolean;
  target: number;
  belowTarget: boolean;
  commissionBaseGp: number;
  commission: number;
  commissionIfPricedCorrectly: number | null;
  excludedServiceCount: number;
  labourSell: number;
  labourTechShare: number;
  labourCompanyShare: number;
  techEarningsTotal: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (gp: number, sell: number) => (sell > 0 ? r2((gp / sell) * 100) : null);
const AREA_NONE = "__none__";

export function lineMargin(l: MarginLineInput, s: MarginSettings): MarginLine {
  const sell = r2(l.qty * l.unitPrice);
  let unitCost: number | null = l.unitCost;
  let status: LineStatus = "ok";
  if (l.isLabour) {
    if (s.labourCostPerHour == null || !(s.labourCostPerHour > 0)) { unitCost = null; status = "labour_cost_not_set"; }
    else unitCost = s.labourCostPerHour;
  } else if (unitCost == null) status = "cost_unknown";
  if (unitCost == null) return { id: l.id, name: l.name, areaId: l.areaId, sell, cost: null, gp: null, gpPercent: null, status };
  const cost = r2(l.qty * unitCost);
  const gp = r2(sell - cost);
  return { id: l.id, name: l.name, areaId: l.areaId, sell, cost, gp, gpPercent: pct(gp, sell), status };
}

/** Commission on GP, never below 0. */
export const commissionOn = (gp: number, commissionPercent: number) => r2(Math.max(0, gp) * (commissionPercent / 100));

/** Sell that exactly meets target GP% on the same cost: cost / (1 − target). */
export const sellForTarget = (cost: number, targetPercent: number) =>
  targetPercent >= 100 ? Infinity : r2(cost / (1 - targetPercent / 100));

export function computeMargin(inputs: MarginLineInput[], discount: number, s: MarginSettings): MarginResult {
  const lines = inputs.map((l) => lineMargin(l, s));
  const counted = lines.filter((l) => l.cost != null);
  const grossSell = r2(lines.reduce((a, l) => a + l.sell, 0));
  const countedSell = counted.reduce((a, l) => a + l.sell, 0);
  const d = Math.max(0, Number(discount) || 0);
  // Discount is spread pro-rata over all sell; only the counted share hits GP.
  const share = (sell: number) => (grossSell > 0 ? (d * sell) / grossSell : 0);

  const areas: Record<string, MarginRollup> = {};
  for (const l of counted) {
    const k = l.areaId ?? AREA_NONE;
    const a = (areas[k] ||= { sell: 0, cost: 0, gp: 0, gpPercent: null });
    a.sell += l.sell - share(l.sell);
    a.cost += l.cost!;
  }
  for (const a of Object.values(areas)) {
    a.sell = r2(a.sell); a.cost = r2(a.cost); a.gp = r2(a.sell - a.cost); a.gpPercent = pct(a.gp, a.sell);
  }

  const sell = r2(countedSell - share(countedSell));
  const cost = r2(counted.reduce((a, l) => a + l.cost!, 0));
  const gp = r2(sell - cost);
  const gpPercent = pct(gp, sell);
  const target = s.gpTargetPercent;
  const belowTarget = gpPercent != null && gpPercent < target;
  const commissionLines = lines.filter((l) => {
    const input = inputs.find((candidate) => candidate.id === l.id);
    return l.cost != null && !input?.isLabour && !input?.isService;
  });
  const commissionSell = r2(commissionLines.reduce((sum, l) => sum + l.sell - share(l.sell), 0));
  const commissionCost = r2(commissionLines.reduce((sum, l) => sum + (l.cost ?? 0), 0));
  const commissionBaseGp = r2(commissionSell - commissionCost);
  const commissionBaseGpPercent = pct(commissionBaseGp, commissionSell);
  const commissionBaseBelowTarget = commissionBaseGpPercent != null && commissionBaseGpPercent < target;
  const labourSell = r2(lines.reduce((sum, l) => {
    const input = inputs.find((candidate) => candidate.id === l.id);
    return input?.isLabour ? sum + l.sell - share(l.sell) : sum;
  }, 0));
  const labourTechShare = r2(Math.max(0, labourSell) * (s.labourTechSharePercent / 100));
  const commission = commissionOn(commissionBaseGp, s.commissionPercent);
  return {
    lines, areas,
    job: { sell, cost, gp, gpPercent, discount: r2(d), grossSell },
    unknownCostCount: lines.filter((l) => l.status === "cost_unknown").length,
    labourExcluded: lines.some((l) => l.status === "labour_cost_not_set"),
    target, belowTarget,
    commissionBaseGp,
    commission,
    commissionIfPricedCorrectly: commissionBaseBelowTarget ? commissionOn(sellForTarget(commissionCost, target) - commissionCost, s.commissionPercent) : null,
    excludedServiceCount: inputs.filter((l) => l.isService).length,
    labourSell,
    labourTechShare,
    labourCompanyShare: r2(labourSell - labourTechShare),
    techEarningsTotal: r2(commission + labourTechShare),
  };
}

export const MARGIN_AREA_NONE = AREA_NONE;
