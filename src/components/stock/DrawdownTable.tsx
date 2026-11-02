import { Input } from "@/components/ui/input";
import { unitShort } from "@/lib/stockUnits";
import type { DrawRow } from "@/lib/materialsDrawdown";

/** Presentational: quote quantity → suggested draw (stock units), editable by the tech. No costs shown. */
export default function DrawdownTable({ rows, qty, onQty }: { rows: DrawRow[]; qty: Record<string, number>; onQty: (key: string, v: number) => void }) {
  return (
    <div className="space-y-2" data-testid="drawdown">
      {rows.map((r) => {
        const editable = !!r.stock_item_id && !r.reserved;
        const v = qty[r.key] ?? r.suggested;
        return (
          <div key={r.key} className="rounded-xl border p-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{r.item}</div>
              <div className="text-[11px] text-muted-foreground">Quoted {r.quoted} {unitShort(r.unit)}{r.stock_item_id ? ` · ${r.on_hand} on hand` : ""}</div>
              {r.note && <div className={`text-[11px] ${/Only/.test(r.note) ? "text-amber-700" : "text-muted-foreground"}`}>{r.note}</div>}
            </div>
            {editable ? (
              <div className="flex items-center gap-1 shrink-0">
                <Input aria-label={`Used ${r.item}`} type="number" inputMode="decimal" step="any" min={0} className="w-20 h-9 text-right" value={v}
                  onChange={(e) => onQty(r.key, Math.max(0, Number(e.target.value) || 0))} />
                <span className="text-xs w-7 text-muted-foreground">{unitShort(r.unit)}</span>
              </div>
            ) : <span className="text-xs text-muted-foreground shrink-0">—</span>}
          </div>
        );
      })}
    </div>
  );
}
