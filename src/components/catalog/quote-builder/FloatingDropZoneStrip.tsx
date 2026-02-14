import { useDroppable } from "@dnd-kit/core";
import { ShoppingBag } from "lucide-react";
import type { Basket } from "../QuoteBuilderTab";

interface FloatingDropZoneStripProps {
  baskets: Basket[];
  visible: boolean;
}

function DropZoneTarget({ basket }: { basket: Basket }) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });
  const itemCount = basket.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed transition-all duration-200 cursor-default ${
        isOver
          ? "border-primary bg-primary/15 shadow-lg ring-2 ring-primary/30 scale-105"
          : "border-primary/30 bg-card/90 hover:border-primary/50"
      }`}
    >
      <ShoppingBag className={`h-4 w-4 shrink-0 ${isOver ? "text-primary" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold truncate ${isOver ? "text-primary" : "text-foreground"}`}>
          {basket.name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {itemCount} item{itemCount !== 1 ? "s" : ""}
        </p>
      </div>
      {isOver && (
        <span className="text-[10px] font-medium text-primary animate-pulse">
          Drop here
        </span>
      )}
    </div>
  );
}

const FloatingDropZoneStrip = ({ baskets, visible }: FloatingDropZoneStripProps) => {
  if (!visible || baskets.length === 0) return null;

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-[60] w-48 space-y-2 animate-in slide-in-from-right-4 duration-200">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 text-center">
        Drop into zone
      </p>
      {baskets.map((basket) => (
        <DropZoneTarget key={basket.id} basket={basket} />
      ))}
    </div>
  );
};

export default FloatingDropZoneStrip;
