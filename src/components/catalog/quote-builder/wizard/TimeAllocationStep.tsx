/**
 * Build Area Quote → Time + Review steps, synced with the Visual PDF / Build tabs.
 * Writes the SAME per-area labour row (quote_items, item_type "labour") that LabourPanel and the
 * estimate use, via QuoteContext — so there is one labour row per area, never a duplicate.
 * Suggested hours = company default (3.5 h) × AC units. Staff only; labour → tech, not sales commission.
 */
import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { findAreaLabour, isLabourItem, planLabour, snapHours, standardLabourRate } from "@/lib/labour";
import { defaultLabourHours, normalizeLabourMode } from "@/lib/areaLabour";
import LabourPanel from "@/components/quoting/LabourPanel";
import { useQuoteLiveTotals } from "@/stores/quoteLiveTotalsStore";
import { formatRand } from "@/utils/formatRand";
import { toast } from "@/hooks/use-toast";
import type { QuoteArea } from "../quoteWizardTypes";
import { ReviewStep } from "./PlaceholderSteps";

const norm = (s: string) => (s || "").trim().toLowerCase();
const unitsOf = (a: QuoteArea) => a.acUnits.reduce((s, u) => s + (Number(u.quantity) || 0), 0);

/** Wizard areas are local; after auto-save the quote area (and its labour row) matches by name. */
function useAreaLabour(areas: QuoteArea[]) {
  const ctx = useQuoteContext();
  const { settings } = useCompanySettings() as any;
  const perUnit = Number(settings?.default_install_labour_hours) || 3.5;
  const standardRate = standardLabourRate(settings?.default_hourly_rate);
  const all = ctx.items.filter((i) => !i.parent_item_id && isLabourItem(i));
  const rows = areas.map((area) => {
    const saved = ctx.areas.find((x) => norm(x.name) === norm(area.name)) || null;
    const line: any = saved ? findAreaLabour(ctx.items, saved.id) ?? null : null;
    const units = unitsOf(area);
    const hours = Number(line?.metadata?.hours ?? line?.quantity ?? 0) || 0;
    return { area, saved, line, units, suggested: defaultLabourHours(units, perUnit), hours, total: Number(line?.total_price) || 0 };
  });
  const labourTotal = all.reduce((s, i) => s + (Number(i.total_price) || 0), 0);
  const jobMode = normalizeLabourMode((ctx.meta as any)?.labour_mode) === "job";
  const write = async (r: (typeof rows)[number], hours: number, rate?: number | null, auto?: boolean) => {
    if (!r.saved) return;
    const plan = planLabour(r.line ?? undefined, snapHours(hours), standardRate, rate);
    if (plan.needsRate || !plan.fields) {
      toast({ title: "Set a labour rate", description: "Type a rate on this row or set the standard rate in Settings." });
      return;
    }
    const f: any = plan.fields;
    const fields = { ...f, metadata: { ...f.metadata, labour_auto: !!auto } };
    if (r.line) await ctx.updateItem(r.line.id, fields);
    else {
      const sort = ctx.items.length ? Math.max(...ctx.items.map((i) => i.sort_order || 0)) + 1 : 0;
      await ctx.addItem({ ...fields, area_id: r.saved.id, sort_order: sort, source: "labour" } as any);
    }
  };
  return { perUnit, standardRate, rows, labourTotal, extra: all.length - rows.filter((r) => r.line).length, jobMode, write };
}

type Row = ReturnType<typeof useAreaLabour>["rows"][number];

function TimeRow({ r, standardRate, write }: { r: Row; standardRate: number | null; write: (r: Row, h: number, rate?: number | null, auto?: boolean) => Promise<void> }) {
  const [h, setH] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const savedRate = Number(r.line?.metadata?.rate) > 0 ? Number(r.line.metadata.rate) : null;
  const off = !r.saved;
  const hasContent = r.area.acUnits.length + r.area.materials.length + r.area.brackets.length + (r.area.consumables?.length || 0) > 0;
  return (
    <div className="grid grid-cols-2 items-center gap-2 border-t py-2 text-xs first:border-t-0 sm:grid-cols-[1fr_auto_auto_auto_auto]" data-testid="time-row">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div className="truncate text-sm font-medium">{r.area.name || "Unnamed area"}</div>
        <div className="text-muted-foreground">{r.units} AC unit{r.units !== 1 ? "s" : ""} · suggested {r.suggested} h</div>
        {off && <div className="text-amber-600">Saving area… labour can be set in a moment</div>}
        {!off && hasContent && r.hours <= 0 && <div className="text-destructive">Labour missing</div>}
      </div>
      <label className="flex items-center gap-1">
        <Input type="number" step={0.5} min={0} disabled={off} aria-label={`Labour hours for ${r.area.name}`}
          value={h ?? String(r.hours)} onChange={(e) => setH(e.target.value)}
          onBlur={() => { if (h == null) return; const v = Number(h); setH(null); if (Number.isFinite(v) && v >= 0 && snapHours(v) !== r.hours) void write(r, v); }}
          className="h-8 w-20 text-right text-xs" /> h
      </label>
      <label className="flex items-center gap-1">
        R<Input type="number" min={0} disabled={off} aria-label={`Labour rate for ${r.area.name}`}
          placeholder={String(savedRate ?? standardRate ?? "Set rate")} value={rate} onChange={(e) => setRate(e.target.value)}
          onBlur={() => { const v = Number(rate); setRate(""); if (Number.isFinite(v) && v > 0 && v !== savedRate) void write(r, r.line ? r.hours : r.suggested, v); }}
          className="h-8 w-24 text-right text-xs" />/h
      </label>
      <div className="w-24 text-right text-sm font-semibold tabular-nums">{r.line ? formatRand(r.total) : "—"}</div>
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={off || r.suggested <= 0 || (!!r.line && r.hours === r.suggested)}
        onClick={() => void write(r, r.suggested, null, true)}>
        Use {r.suggested} h
      </Button>
    </div>
  );
}

export function TimeAllocationStep({ areas }: { areas: QuoteArea[]; onAreasChange?: (a: QuoteArea[]) => void }) {
  const L = useAreaLabour(areas);
  if (L.jobMode) {
    const units = L.rows.reduce((s, r) => s + r.units, 0);
    return (
      <div className="space-y-2" data-testid="time-step">
        <p className="text-xs text-muted-foreground">This quote uses one whole-job labour row. Suggested: {defaultLabourHours(units, L.perUnit)} h ({units} AC units × {L.perUnit} h).</p>
        <LabourPanel />
      </div>
    );
  }
  const empty = L.rows.filter((r) => r.saved && !r.line && r.suggested > 0);
  return (
    <div className="space-y-3" data-testid="time-step">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Labour per area</h3>
          <p className="text-xs text-muted-foreground">
            {L.perUnit} h per AC unit · {L.standardRate == null ? "standard rate not set" : `${formatRand(L.standardRate)}/h`} excl. VAT · staff only. Same labour rows as the Visual PDF tab and the estimate.
          </p>
        </div>
        {empty.length > 0 && (
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={async () => { for (const r of empty) await L.write(r, r.suggested, null, true); }}>
            <Wand2 className="h-3.5 w-3.5" /> Use suggested for {empty.length} area{empty.length !== 1 ? "s" : ""}
          </Button>
        )}
      </div>
      {areas.length === 0 ? (
        <p className="text-xs text-muted-foreground">No areas defined.</p>
      ) : (
        <div className="rounded-lg border bg-card px-3">
          {L.rows.map((r) => <TimeRow key={r.area.id} r={r} standardRate={L.standardRate} write={L.write} />)}
        </div>
      )}
      <div className="flex justify-between border-t pt-2 text-sm font-semibold" data-testid="time-labour-subtotal">
        <span>Labour subtotal{L.extra > 0 ? ` (incl. ${L.extra} other labour line${L.extra !== 1 ? "s" : ""})` : ""}</span>
        <span className="tabular-nums">{formatRand(L.labourTotal)}</span>
      </div>
    </div>
  );
}

/** Review: area summary + labour per area, then the same totals as the header (incl. labour). */
export function ReviewWithLabourStep({ areas }: { areas: QuoteArea[]; onAreasChange?: (a: QuoteArea[]) => void }) {
  const L = useAreaLabour(areas);
  const live = useQuoteLiveTotals();
  const labourByArea = Object.fromEntries(L.rows.map((r) => [r.area.id, { hours: r.hours, total: r.total }]));
  return (
    <div className="space-y-3">
      <ReviewStep areas={areas} onAreasChange={() => {}} labourByArea={labourByArea} />
      <div className="space-y-1 rounded border bg-card p-3 text-xs" data-testid="review-totals">
        <div className="flex justify-between"><span>Labour subtotal</span><span className="tabular-nums">{formatRand(L.labourTotal)}</span></div>
        <div className="flex justify-between"><span>Quote subtotal excl. VAT (incl. labour)</span><span className="tabular-nums">{formatRand(live.subtotal)}</span></div>
        <div className="flex justify-between"><span>VAT</span><span className="tabular-nums">{formatRand(live.vat)}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>Total incl. VAT</span><span className="tabular-nums">{formatRand(live.total)}</span></div>
      </div>
    </div>
  );
}
