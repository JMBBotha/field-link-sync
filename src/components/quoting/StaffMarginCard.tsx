/**
 * StaffMarginCard — internal cost / markup / profit for the open quote.
 * Rendered OUTSIDE the pdf capture root and hidden on print: cost and profit
 * must never appear on the client-facing estimate.
 */
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeOverrun, parseExtras } from "@/lib/overrun";
import type { QuoteItem } from "@/types/quote";
import { isLabourItem } from "@/lib/labour";
import { computeMargin, MARGIN_AREA_NONE, type MarginLine, type MarginLineInput, type MarginSettings } from "@/lib/margin";

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Cost snapshot stored on the line; null = cost unknown (never treated as R0). */
export const lineUnitCostOrNull = (item: QuoteItem): number | null => {
  const meta = (item.metadata || {}) as Record<string, any>;
  const raw = meta.unit_cost ?? meta.cost ?? meta.cost_price;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Back-compat: 0 when unknown. Prefer lineUnitCostOrNull. */
export const lineUnitCost = (item: QuoteItem): number => lineUnitCostOrNull(item) ?? 0;

/** Cost/profit/markup over lines with a known cost only; unknown-cost lines are counted, not assumed R0. */
export function computeStaffMargin(items: QuoteItem[]) {
  const topLevel = items.filter((i) => !i.parent_item_id);
  let cost = 0, knownSell = 0, sell = 0, unknownCount = 0, unknownSell = 0;
  for (const i of topLevel) {
    const q = Number(i.quantity || 0), s = q * Number(i.unit_price || 0);
    sell += s;
    const c = lineUnitCostOrNull(i);
    if (c == null) { unknownCount++; unknownSell += s; continue; }
    cost += q * c; knownSell += s;
  }
  const profit = knownSell - cost;
  return { cost, sell, knownSell, profit, markupPercent: cost > 0 ? (profit / cost) * 100 : 0, unknownCount, unknownSell };
}

interface Props {
  items: QuoteItem[];
  selectedId: string | null;
  areas: { id: string; name: string }[];
  discount: number;
  settings: MarginSettings;
  /** Enables the "Actual vs quoted" section when a job_overruns row exists. */
  quoteId?: string | null;
}

const pctText = (p: number | null) => (p == null ? "—" : `${p.toFixed(1)}%`);

export default function StaffMarginCard({ items, selectedId, areas, discount, settings, quoteId }: Props) {
  const { data: overrun } = useQuery({
    queryKey: ["job-overrun", quoteId],
    enabled: !!quoteId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase.from("job_overruns" as any) as any)
        .select("actual_hours, extra_items, notes, created_at").eq("quote_id", quoteId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return null;
      const extras = parseExtras(data.extra_items);
      const ids = extras.map((e) => e.product_id).filter(Boolean) as string[];
      const costs = new Map<string, number>();
      if (ids.length) {
        const { data: ps } = await (supabase.from("supplier_products") as any).select("id, cost_price, cost_excl_vat").in("id", ids);
        for (const p of ps || []) costs.set(p.id, Number(p.cost_price || p.cost_excl_vat || 0));
      }
      return { actualHours: data.actual_hours == null ? null : Number(data.actual_hours), extras: extras.map((e) => ({ ...e, unitCost: e.product_id ? costs.get(e.product_id) ?? null : null })), notes: data.notes as string | null };
    },
  });
  const inputs: MarginLineInput[] = items.filter((i) => !i.parent_item_id).map((i) => ({
    id: i.id, name: i.item_name, areaId: i.area_id ?? null,
    qty: Number(i.quantity || 0), unitPrice: Number(i.unit_price || 0),
    unitCost: lineUnitCostOrNull(i), isLabour: isLabourItem(i),
  }));
  const m = computeMargin(inputs, discount, settings);
  const areaName = (id: string) => (id === MARGIN_AREA_NONE ? "Other items" : areas.find((a) => a.id === id)?.name ?? "Area");
  const selected = m.lines.find((l) => l.id === selectedId) || null;
  const quotedHours = items.filter((i) => !i.parent_item_id && isLabourItem(i)).reduce((a, i) => a + Number((i.metadata as any)?.hours ?? i.quantity ?? 0), 0);
  const ov = overrun ? computeOverrun({ quotedHours, actualHours: overrun.actualHours, extras: overrun.extras, job: m.job, labourCostPerHour: settings.labourCostPerHour, commissionPercent: settings.commissionPercent }) : null;
  const statusText = (l: MarginLine) =>
    l.status === "cost_unknown" ? "cost unknown" : l.status === "labour_cost_not_set" ? "labour cost not set" : null;

  return (
    <Card className="space-y-3 p-4 print:hidden" data-testid="staff-margin-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Profit — staff only</h2>
        <span className="text-[11px] text-muted-foreground">Never printed on the estimate</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-[11px] text-muted-foreground">Sell ex VAT</p><p className="font-semibold tabular-nums">{money(m.job.sell)}</p></div>
        <div><p className="text-[11px] text-muted-foreground">Cost</p><p className="font-semibold tabular-nums">{money(m.job.cost)}</p></div>
        <div><p className="text-[11px] text-muted-foreground">GP</p><p className="font-semibold tabular-nums">{money(m.job.gp)}</p></div>
        <div><p className="text-[11px] text-muted-foreground">GP % · Target {m.target}% GP</p><p className="font-semibold tabular-nums">{pctText(m.job.gpPercent)}</p></div>
      </div>
      {m.job.discount > 0 && <p className="text-[11px] text-muted-foreground">Includes quote discount of {money(m.job.discount)}.</p>}

      {m.belowTarget && (
        <p role="status" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Job GP {pctText(m.job.gpPercent)} is below the {m.target}% target.
        </p>
      )}
      {m.labourExcluded && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs">GP excludes labour — set labour cost rate in Settings</p>
      )}
      {m.unknownCostCount > 0 && (
        <p className="text-xs text-destructive">{m.unknownCostCount} {m.unknownCostCount === 1 ? "line" : "lines"} without cost — left out of GP.</p>
      )}

      <div className="rounded-md border border-border p-3 text-sm">
        <p>Your commission: <span className="font-semibold tabular-nums">{money(m.commission)}</span></p>
        {m.commissionIfPricedCorrectly != null && (
          <p>If priced correctly: <span className="font-semibold tabular-nums">{money(m.commissionIfPricedCorrectly)}</span></p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Earned when the invoice is paid in full; overruns deducted</p>
      </div>

      {ov && (
        <div className="rounded-md border border-border p-3 text-sm" data-testid="actual-vs-quoted">
          <p className="mb-1 text-xs font-semibold">Actual vs quoted</p>
          <p className="text-xs">Labour: quoted {ov.quotedHours} h · actual {ov.actualHours ?? "—"} h{ov.extraHours > 0 ? ` (+${ov.extraHours} h)` : ""}</p>
          {ov.extraHours > 0 && (ov.labourNotSet
            ? <p className="text-xs text-muted-foreground">Labour overrun: labour cost not set — excluded</p>
            : <p className="text-xs">Labour overrun cost: <span className="tabular-nums">{money(ov.labourCost ?? 0)}</span></p>)}
          <p className="text-xs">Extra materials cost: <span className="tabular-nums">{money(ov.extrasCost)}</span>{ov.unknownExtras > 0 ? ` · ${ov.unknownExtras} without catalogue cost` : ""}</p>
          <p className="mt-1">Adjusted GP: <span className="font-semibold tabular-nums">{money(ov.adjustedGp)}</span> · {pctText(ov.adjustedGpPercent)}</p>
          <p>Adjusted commission: <span className="font-semibold tabular-nums">{money(ov.adjustedCommission)}</span> <span className="text-[11px] text-muted-foreground">overruns deducted</span></p>
          {overrun?.notes && <p className="mt-1 text-[11px] text-muted-foreground">Tech note: {overrun.notes}</p>}
        </div>
      )}

      {Object.keys(m.areas).length > 0 && (
        <div className="space-y-1 text-xs">
          {Object.entries(m.areas).map(([id, a]) => (
            <div key={id} className="flex justify-between gap-2">
              <span className="truncate">{areaName(id)}</span>
              <span className="tabular-nums">{money(a.gp)} · {pctText(a.gpPercent)}</span>
            </div>
          ))}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Per line</summary>
        <div className="mt-2 space-y-1">
          {m.lines.map((l) => (
            <div key={l.id} className={`grid grid-cols-[1fr_auto] gap-2 ${l.id === selected?.id ? "font-semibold" : ""}`}>
              <span className="truncate">{l.name}</span>
              <span className="tabular-nums">
                {statusText(l) ?? `${money(l.cost!)} → ${money(l.sell)} · ${money(l.gp!)} · ${pctText(l.gpPercent)}`}
              </span>
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}
