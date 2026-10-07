import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRand } from "@/utils/formatRand";
import type { EstimateEditLine } from "@/components/quoting/EstimateDocument";

interface Props {
  areaId: string;
  areaName: string;
  lines: EstimateEditLine[];
  defaultHours: number;
  onAdd: () => void;
  onChange: (id: string, hours: number, rate?: number) => void;
  /** Row label; defaults to 'Labour for <area name>'. */
  title?: string;
  onRemove?: (id: string) => void;
}

export default function AreaLabourRow({ areaId, areaName, lines, defaultHours, onAdd, onChange, title, onRemove }: Props) {
  const hours = lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
  return (
    <div id={`area-labour-${areaId}`} data-testid={`area-labour-${areaId}`} className="mt-2 border-t border-slate-200 pt-2 print:hidden">
      {hours <= 0 && (
        <div className="mb-2 flex items-center justify-between gap-3 bg-card text-foreground border-2 border-orange-500 px-3 py-2 text-xs">
          <span className="font-medium">Labour needed</span>
          <Button type="button" size="sm" variant="outline" onClick={onAdd}>Add labour</Button>
        </div>
      )}
      {lines.map((line) => {
        const differs = !line.labourAuto && defaultHours > 0 && Math.abs(line.quantity - defaultHours) > 0.001;
        return (
          <div key={line.id} className="grid items-center gap-2 text-xs sm:grid-cols-[minmax(160px,1fr)_100px_120px_110px_auto]">
            <div>
              <span className="font-medium text-slate-800">{title ?? `Labour for ${areaName}`}</span>
              {differs && <span className="ml-2 text-[10px] text-slate-500">Default for {line.acUnitCount} units: {defaultHours} h</span>}
            </div>
            <label className="flex items-center gap-1 text-slate-500">
              <Input aria-label={`Labour hours for ${areaName}`} type="number" min="0" step="0.5" defaultValue={line.quantity} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== line.quantity) onChange(line.id, v); }} className="h-8 text-right" /> h
            </label>
            <label className="flex items-center gap-1 text-slate-500">
              R <Input aria-label={`Labour rate for ${areaName}`} type="number" min="0" step="0.01" defaultValue={line.unit_price} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== line.unit_price) onChange(line.id, line.quantity, v); }} className="h-8 text-right" /> /h
            </label>
            <span className="text-right font-semibold text-slate-900">{formatRand(line.quantity * line.unit_price)}</span>
            {onRemove && <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[11px]" aria-label={`Remove labour for ${areaName}`} onClick={() => onRemove(line.id)}>Remove</Button>}
          </div>
        );
      })}
    </div>
  );
}