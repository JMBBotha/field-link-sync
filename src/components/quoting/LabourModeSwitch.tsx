/**
 * Staff-only "Labour: one total for whole job" switch. Ticked = labour mode 'job', unticked = 'per_area'.
 * Switching is instant through set_quote_labour_mode, with an Undo toast that switches back.
 * Never printed (print:hidden + data-html2canvas-ignore).
 */
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuoteContext, trackQuoteWrite } from "@/contexts/QuoteContext";
import { countAcUnits, normalizeLabourMode, type LabourMode } from "@/lib/areaLabour";

export const LABOUR_SWITCH_LABEL = "Labour: one total for whole job";

/** One switch path for every screen. `unitsFor` lets a caller count units with product info. */
export function useLabourModeSwitch(perUnitHours: number, unitsFor?: (areaId: string) => number, onChanged?: () => void) {
  const { quoteId, meta, areas, items, refetch } = useQuoteContext();
  const mode = normalizeLabourMode((meta as any)?.labour_mode);
  const [busy, setBusy] = useState(false);
  const run = async (next: LabourMode) => {
    const unitsByArea: Record<string, number> = {};
    for (const a of areas) unitsByArea[a.id] = unitsFor ? unitsFor(a.id) : countAcUnits(items.filter((i) => !i.parent_item_id && i.area_id === a.id) as any);
    const { error } = await trackQuoteWrite<any>((supabase as any).rpc("set_quote_labour_mode", { p_quote_id: quoteId, p_mode: next, p_per_unit_hours: perUnitHours, p_area_units: unitsByArea }));
    if (error) throw error;
    await refetch();
    onChanged?.();
  };
  const switchTo = async (next: LabourMode, undo = true) => {
    if (next === mode || busy) return;
    setBusy(true);
    try {
      await run(next);
      if (undo) {
        const back: LabourMode = next === "job" ? "per_area" : "job";
        toast({
          title: next === "job" ? "Labour moved to one job line. Custom hours per room are re-split if you switch back." : "Labour split back into the areas.",
          action: <ToastAction altText="Undo" onClick={() => { void run(back).catch((e) => toast({ title: "Could not undo", description: e.message, variant: "destructive" })); }}>Undo</ToastAction>,
        });
      }
    } catch (e: any) {
      toast({ title: "Could not change labour mode", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return { mode, busy, switchTo };
}

export const LABOUR_SWITCH_OFF_TEXT = "Per area";
export const LABOUR_SWITCH_ON_TEXT = "One total for whole job";

/**
 * High-visibility toggle (Johan 2026-10-09): ON = strong orange like the labour rows,
 * OFF = darker slate track + border, white thumb with shadow in both themes, labels on both sides.
 * Own solid white pill with fixed hex colours (data-paper/data-solid, bg-[#ffffff], text-[#…]) so the app's dark-mode
 * remaps (.bg-white glass, .estimate-editing text ladder) can't turn it grey; reads the same on white paper and dark panels.
 */
export default function LabourModeSwitch({ checked, disabled, onChange, className = "" }: { checked: boolean; disabled?: boolean; onChange: (job: boolean) => void; className?: string }) {
  const side = (active: boolean) =>
    active ? "font-semibold text-[#c2410c]" : "font-medium text-[#334155]";
  return (
    <div data-testid="labour-mode-switch" data-paper data-solid className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-full bg-[#ffffff] px-2.5 py-1 text-xs ring-1 ring-[#94a3b8] sm:gap-x-2 sm:px-3 sm:text-sm print:hidden ${className}`} data-pdf-hide data-html2canvas-ignore>
      <span className="hidden font-medium text-[#1e293b] sm:inline">Labour:</span>
      <button type="button" data-no-min disabled={disabled} onClick={() => onChange(false)} className={`whitespace-nowrap rounded px-0.5 ${side(!checked)}`}>{LABOUR_SWITCH_OFF_TEXT}</button>
      <Switch
        data-no-min
        aria-label={LABOUR_SWITCH_LABEL}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(!!v)}
        className="h-6 w-11 border-2 shadow-inner data-[state=unchecked]:border-orange-400 data-[state=unchecked]:bg-orange-200 data-[state=checked]:border-orange-700 data-[state=checked]:bg-orange-600 [&>span]:bg-white [&>span]:shadow-[0_1px_3px_rgba(0,0,0,0.45)] [&>span]:ring-1 [&>span]:ring-black/10"
      />
      <button type="button" data-no-min disabled={disabled} onClick={() => onChange(true)} className={`whitespace-nowrap rounded px-0.5 ${side(checked)}`}>{LABOUR_SWITCH_ON_TEXT}</button>
    </div>
  );
}
