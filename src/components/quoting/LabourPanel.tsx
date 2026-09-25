/**
 * Staff-only hourly Labour row per quote area (estimate page + full builder).
 * Writes through QuoteContext like every other quote control. Hours step 0.5,
 * rate defaults to the company standard rate and can be overridden per row.
 * Clients never see this breakdown — labour rolls into the area total.
 */
import { useState } from "react";
import { Minus, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { findAreaLabour, planLabour, standardLabourRate, stepHours } from "@/lib/labour";
import { formatRand } from "@/utils/formatRand";
import { toast } from "@/hooks/use-toast";

function LabourRow({ areaId, areaName, standardRate }: { areaId: string; areaName: string; standardRate: number | null }) {
  const ctx = useQuoteContext();
  const line = findAreaLabour(ctx.items, areaId);
  const md = (line?.metadata || {}) as { hours?: number; rate?: number };
  const hours = Number(md.hours ?? line?.quantity ?? 0);
  const savedRate = Number(md.rate) > 0 ? Number(md.rate) : null;
  const [rateDraft, setRateDraft] = useState<string>("");
  const shownRate = savedRate ?? standardRate;

  const commit = async (nextHours: number, explicitRate?: number | null) => {
    const plan = planLabour(line, nextHours, standardRate, explicitRate);
    if (plan.needsRate) {
      toast({ title: "Set a labour rate", description: "Type a rate on this row or set the standard rate in Settings." });
      return;
    }
    if (line) await ctx.updateItem(line.id, plan.fields as any);
    else {
      const sort = ctx.items.length ? Math.max(...ctx.items.map((i) => i.sort_order || 0)) + 1 : 0;
      await ctx.addItem({ ...plan.fields, area_id: areaId, sort_order: sort, source: "labour" } as any);
    }
  };

  const onRateBlur = () => {
    const v = Number(rateDraft);
    setRateDraft("");
    if (Number.isFinite(v) && v > 0 && v !== savedRate) void commit(hours, v);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 py-2 first:border-t-0" data-testid={`labour-row-${areaId}`}>
      <div className="min-w-[110px] flex-1 text-sm font-medium">{areaName}</div>
      <div className="flex items-center gap-1">
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Less labour" disabled={hours <= 0} onClick={() => commit(stepHours(hours, -1))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-14 text-center text-sm tabular-nums">{hours} h</span>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="More labour" onClick={() => commit(stepHours(hours, 1))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        ×
        <Input
          type="number"
          min="0"
          step="0.01"
          aria-label="Labour rate per hour"
          placeholder={shownRate == null ? "Set rate in Settings" : String(shownRate)}
          value={rateDraft}
          onChange={(e) => setRateDraft(e.target.value)}
          onBlur={onRateBlur}
          className="h-8 w-36 text-right text-xs"
        />
        /h
      </div>
      <div className="w-28 text-right text-sm font-semibold tabular-nums">
        {line ? formatRand(Number(line.total_price) || 0) : "—"}
      </div>
    </div>
  );
}

export default function LabourPanel() {
  const ctx = useQuoteContext();
  const { settings } = useCompanySettings() as any;
  const standardRate = standardLabourRate(settings?.default_hourly_rate);
  if (!ctx.areas.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid="labour-panel">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Wrench className="h-4 w-4" /> Labour per area
        <span className="text-xs font-normal text-muted-foreground">
          {standardRate == null ? "Standard rate not set — Set rate in Settings or type one on a row" : `Standard ${formatRand(standardRate)}/h excl. VAT · 0% markup · staff only`}
        </span>
      </div>
      {ctx.areas.map((a) => (
        <LabourRow key={a.id} areaId={a.id} areaName={a.name} standardRate={standardRate} />
      ))}
    </div>
  );
}
