/**
 * Owner money flow (Job 4) — pure helpers over get_owner_money_flow().
 * Segments are data-driven: Job 6 adds tech_held / company_tools as extra keys, no redesign.
 * Labour cost == tech share; it is never added as a separate cost.
 */
export type FlowGroup = "cost" | "sales" | "tech" | "company";
export type FlowView = "earned" | "pending" | "all";
export interface FlowSegmentDef { key: string; group: FlowGroup; label: string; order: number }
export interface FlowBucket { quotes: number; revenue_ex_vat: number; segments: Record<string, number> }
export interface FlowMonth { month: string; bucket: "earned" | "pending"; revenue_ex_vat: number; segments: Record<string, number> }
export interface FlowPerson { role: "sales" | "tech"; profile_id: string | null; name: string; earned: number; pending: number; quotes: number }
export interface MoneyFlow {
  api_version: number;
  company_id: string;
  segments: FlowSegmentDef[];
  totals: { earned: FlowBucket; pending: FlowBucket };
  months: FlowMonth[];
  people: FlowPerson[];
}

export const GROUPS: { key: FlowGroup; label: string; color: string }[] = [
  { key: "cost", label: "Item cost", color: "#94a3b8" },
  { key: "sales", label: "Sales commission", color: "#3b82f6" },
  { key: "tech", label: "Tech labour share", color: "#f59e0b" },
  { key: "company", label: "Company keeps", color: "#16a34a" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Revenue + per-segment amounts for the chosen view. */
export function viewTotals(flow: MoneyFlow, view: FlowView): { quotes: number; revenue: number; segments: Record<string, number> } {
  const buckets = view === "all" ? [flow.totals.earned, flow.totals.pending] : [flow.totals[view]];
  const segments: Record<string, number> = {};
  for (const d of flow.segments) segments[d.key] = r2(buckets.reduce((a, b) => a + num(b?.segments?.[d.key]), 0));
  return {
    quotes: buckets.reduce((a, b) => a + num(b?.quotes), 0),
    revenue: r2(buckets.reduce((a, b) => a + num(b?.revenue_ex_vat), 0)),
    segments,
  };
}

/** Sum segments into their group (tiles, monthly stacks). */
export function groupTotals(defs: FlowSegmentDef[], segments: Record<string, number>): Record<FlowGroup, number> {
  const out: Record<FlowGroup, number> = { cost: 0, sales: 0, tech: 0, company: 0 };
  for (const d of defs) out[d.group] = r2(out[d.group] + num(segments[d.key]));
  return out;
}

export interface WaterfallBar { name: string; base: number; value: number; amount: number; color: string; total?: boolean }

/** Revenue, then each segment floating down to zero (order: cost, sales, tech, company). */
export function waterfall(defs: FlowSegmentDef[], revenue: number, segments: Record<string, number>): WaterfallBar[] {
  const color = (g: FlowGroup) => GROUPS.find((x) => x.key === g)?.color ?? "#64748b";
  const bars: WaterfallBar[] = [{ name: "Revenue ex VAT", base: 0, value: r2(revenue), amount: r2(revenue), color: "#0f172a", total: true }];
  let running = revenue;
  const order: FlowGroup[] = ["cost", "sales", "tech", "company"];
  const sorted = [...defs].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.order - b.order);
  for (const d of sorted) {
    const amt = num(segments[d.key]);
    const next = running - amt;
    bars.push({ name: d.label, base: r2(Math.min(running, next)), value: r2(Math.abs(amt)), amount: r2(amt), color: color(d.group) });
    running = next;
  }
  return bars;
}

/** Monthly stacked groups for phones. view=all adds earned + pending. */
export function monthlyGroups(flow: MoneyFlow, view: FlowView): ({ month: string } & Record<FlowGroup, number>)[] {
  const byMonth = new Map<string, Record<string, number>>();
  for (const m of flow.months) {
    if (view !== "all" && m.bucket !== view) continue;
    const acc = byMonth.get(m.month) ?? {};
    for (const [k, v] of Object.entries(m.segments || {})) acc[k] = num(acc[k]) + num(v);
    byMonth.set(m.month, acc);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, segs]) => ({ month, ...groupTotals(flow.segments, segs) }));
}
