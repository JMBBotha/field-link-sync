import { useState, useRef, useCallback, useEffect } from "react";
import { calcSellingPrice } from "@/utils/pricing";
import { X, GripVertical, Minus, Maximize2, ChevronUp, ChevronDown, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";

interface FloatingSelectedItemsProps {
  pdfSelection: PdfSelectionHandlers;
  onClose: () => void;
}

const FloatingSelectedItems = ({ pdfSelection, onClose }: FloatingSelectedItemsProps) => {
  const [pos, setPos] = useState({ x: window.innerWidth - 340, y: 80 });
  const [minimized, setMinimized] = useState(false);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const items = pdfSelection.selectedFromPdf;
  const total = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * i.quantity, 0);

  return (
    <div
      className="fixed z-[9999] rounded-xl border bg-card shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: minimized ? 200 : 300 }}
    >
      {/* Drag handle + header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-xl cursor-grab active:cursor-grabbing select-none"
        style={{ backgroundColor: "hsl(var(--primary))" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="h-3.5 w-3.5 text-primary-foreground/70" />
        <span className="text-xs font-semibold text-primary-foreground flex-1">
          Selected Items
        </span>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-primary-foreground/20 text-primary-foreground border-0">
          {items.length}
        </Badge>
        <button onClick={() => setMinimized(!minimized)} className="text-primary-foreground/70 hover:text-primary-foreground">
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onClose} className="text-primary-foreground/70 hover:text-primary-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <div className="p-2 max-h-72 overflow-y-auto space-y-1.5">
          {items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic text-center py-4">
              Select products from PDF view
            </p>
          ) : (
            items.map((item) => (
              <div key={item.code} className="bg-muted/50 p-2 rounded-md space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-foreground truncate flex-1">{item.code}</p>
                  <button
                    onClick={() => pdfSelection.handleSelectProduct(item)}
                    className="text-muted-foreground hover:text-destructive ml-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                {/* Cost & Markup row with adjustment controls */}
                {(item.costPrice != null || item.markupPercent != null) && (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {item.costPrice != null && (
                      <span>Cost: <span className="font-mono font-medium text-foreground">R{Number(item.costPrice).toFixed(2)}</span></span>
                    )}
                    {item.markupPercent != null && item.costPrice != null && (
                      <div className="flex items-center gap-0.5">
                        <span>M/Up:</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-4 w-4"
                          onClick={() => {
                            const cost = Number(item.costPrice);
                            const newMarkup = Math.max(0, (item.markupPercent || 0) - 5);
                            const { sellingExclVat } = calcSellingPrice(cost, newMarkup);
                            pdfSelection.updateSelectedItem(item.code, { markupPercent: newMarkup, price: String(Math.round(sellingExclVat * 100) / 100) } as any);
                          }}
                        >
                          <ChevronDown className="h-2.5 w-2.5" />
                        </Button>
                        <span className="font-mono font-semibold text-primary min-w-[32px] text-center">{Number(item.markupPercent).toFixed(1)}%</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-4 w-4"
                          onClick={() => {
                            const cost = Number(item.costPrice);
                            const newMarkup = (item.markupPercent || 0) + 5;
                            const { sellingExclVat } = calcSellingPrice(cost, newMarkup);
                            pdfSelection.updateSelectedItem(item.code, { markupPercent: newMarkup, price: String(Math.round(sellingExclVat * 100) / 100) } as any);
                          }}
                        >
                          <ChevronUp className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    )}
                    {item.markupPercent != null && item.costPrice == null && (
                      <span>M/Up: <span className="font-mono font-medium text-foreground">{Number(item.markupPercent).toFixed(1)}%</span></span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <select
                    value={item.unitType}
                    onChange={(e) => pdfSelection.updateSelectedItem(item.code, { unitType: e.target.value })}
                    className="h-6 text-[10px] rounded border border-input bg-background px-1"
                  >
                    <option value="units">Units</option>
                    <option value="meters">Meters</option>
                  </select>
                  <Input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={item.quantity}
                    onChange={(e) => pdfSelection.updateSelectedItem(item.code, { quantity: Math.max(0.1, Number(e.target.value)) })}
                    className="h-6 w-16 text-[10px] px-1"
                  />
                  <span className="text-[10px] font-medium text-foreground ml-auto">
                    R{((parseFloat(item.price) || 0) * item.quantity).toFixed(2)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Total footer */}
      {!minimized && items.length > 0 && (
        <div className="border-t px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Total</span>
          <span className="text-sm font-bold text-foreground">R{total.toFixed(2)}</span>
        </div>
      )}

      {minimized && items.length > 0 && (
        <div className="px-3 py-1.5">
          <span className="text-xs font-bold text-foreground">R{total.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
};

export default FloatingSelectedItems;
