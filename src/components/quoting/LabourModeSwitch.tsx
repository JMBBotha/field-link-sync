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

export default function LabourModeSwitch({ checked, disabled, onChange, className = "" }: { checked: boolean; disabled?: boolean; onChange: (job: boolean) => void; className?: string }) {
  return (
    <label data-testid="labour-mode-switch" className={`flex items-center gap-2 text-sm print:hidden ${className}`} data-pdf-hide data-html2canvas-ignore>
      <Switch aria-label={LABOUR_SWITCH_LABEL} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(!!v)} />
      <span>{LABOUR_SWITCH_LABEL}</span>
    </label>
  );
}
