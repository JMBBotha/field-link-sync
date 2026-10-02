import { Badge } from "@/components/ui/badge";
import type { QuoteArea } from "../quoteWizardTypes";
import { computeAreaSubtotal } from "../quoteWizardTypes";

interface StepProps {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  /** Synced builder only: labour per wizard area id (the Review then shows the header totals instead of Grand Total). */
  labourByArea?: Record<string, { hours: number; total: number }>;
}

export function TimeAllocationStep({ areas }: StepProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
      <h3 className="text-sm font-medium">Time Allocation</h3>
      <p className="text-xs text-muted-foreground max-w-md">
        Labour is 3.5 h per AC unit (R680/h standard), set per area in the Labour panel after adding these areas.
      </p>
    </div>
  );
}

export function ReviewStep({ areas, labourByArea }: StepProps) {
  const grandTotal = areas.reduce((s, a) => s + computeAreaSubtotal(a), 0);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Quote Summary</h3>
      {areas.length === 0 ? (
        <p className="text-xs text-muted-foreground">No areas defined.</p>
      ) : (
        <div className="space-y-2">
          {areas.map((area) => {
            const sub = computeAreaSubtotal(area);
            return (
              <div key={area.id} className="rounded border bg-card p-3 text-xs space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{area.name}</span>
                  <span>R {sub.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="text-muted-foreground">
                  {area.acUnits.length} AC unit{area.acUnits.length !== 1 ? "s" : ""} · {area.materials.length} material{area.materials.length !== 1 ? "s" : ""} · {area.brackets.length} bracket type{area.brackets.length !== 1 ? "s" : ""}
                </div>
                {labourByArea && (
                  <div className={labourByArea[area.id]?.hours ? "flex justify-between" : "text-destructive"}>
                    {labourByArea[area.id]?.hours ? (
                      <><span>Labour {labourByArea[area.id].hours} h</span><span>R {labourByArea[area.id].total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span></>
                    ) : "Labour missing — set it in the Time step"}
                  </div>
                )}
              </div>
            );
          })}
          {!labourByArea && <div className="flex justify-end pt-2 border-t text-sm">
            <span className="text-muted-foreground mr-2">Grand Total:</span>
            <span className="font-bold">R {grandTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
          </div>}
        </div>
      )}
    </div>
  );
}
