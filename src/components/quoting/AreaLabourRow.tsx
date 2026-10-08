import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRand } from "@/utils/formatRand";
import type { EstimateEditLine } from "@/components/quoting/EstimateDocument";
import { useState } from "react";

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
  defaultRate?: number;
}

export default function AreaLabourRow({ areaId, areaName, lines, defaultHours, onAdd, onChange, title, onRemove, defaultRate = 680 }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!lines.length && defaultHours <= 0) return null;
  const visibleLines = lines.length ? lines : [{ id: "missing", quantity: 0, unit_price: defaultRate, labourAuto: true, acUnitCount: 0 }];
  const number = (value: number) => value.toLocaleString("en-ZA").replace(".", ",");
  return (
    <div id={`area-labour-${areaId}`} data-testid={`area-labour-${areaId}`} className="mt-3 print:hidden" data-html2canvas-ignore>
      {visibleLines.map((line) => {
        const differs = !line.labourAuto && defaultHours > 0 && Math.abs(line.quantity - defaultHours) > 0.001;
        const save = (field: "hours" | "rate", raw: string) => {
          setEditing(null);
          const value = Number(raw);
          if (!raw.trim() || !Number.isFinite(value) || value < 0) return;
          if (field === "hours" && value !== line.quantity) onChange(line.id, value);
          if (field === "rate" && value !== line.unit_price) onChange(line.id, line.quantity, value);
        };
        return (
          <div key={line.id} data-solid data-testid="area-labour-hours-row" className="option1-labour mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card border-2 border-orange-500 px-3 py-2 text-sm" title={differs ? `Default for ${line.acUnitCount} units: ${defaultHours} h` : undefined}>
            <span className="font-bold">{title ?? `Labour for ${areaName}`}</span>
            <div className="flex items-center gap-1">
              {editing === `${line.id}-hours` ? <Input autoFocus data-solid aria-label={`Labour hours for ${areaName}`} type="number" min="0" step="0.5" defaultValue={line.quantity} onBlur={(event) => save("hours", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-7 w-16 text-right" /> : <Button data-solid type="button" variant="ghost" aria-label={`Edit labour hours for ${areaName}`} className="h-7 px-1 font-normal" onClick={() => line.id === "missing" ? onAdd() : setEditing(`${line.id}-hours`)}>{number(line.quantity)}</Button>}
              <span>h × R</span>
              {editing === `${line.id}-rate` ? <Input autoFocus data-solid aria-label={`Labour rate for ${areaName}`} type="number" min="0" step="0.01" defaultValue={line.unit_price} onBlur={(event) => save("rate", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-7 w-20 text-right" /> : <Button data-solid type="button" variant="ghost" aria-label={`Edit labour rate for ${areaName}`} className="h-7 px-1 font-normal" onClick={() => line.id === "missing" ? onAdd() : setEditing(`${line.id}-rate`)}>{number(line.unit_price)}</Button>}
              <span>/h</span>
            </div>
            <span className="ml-auto text-right font-bold">= {formatRand(line.quantity * line.unit_price)}</span>
            {onRemove && editing?.startsWith(`${line.id}-`) && line.id !== "missing" && <Button data-solid type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" aria-label={`Remove labour for ${areaName}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onRemove(line.id); setEditing(null); }}>Remove</Button>}
          </div>
        );
      })}
    </div>
  );
}