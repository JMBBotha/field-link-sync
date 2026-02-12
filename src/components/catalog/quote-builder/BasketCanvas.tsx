import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Trash2, Pencil, Check, Minus, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Basket, BasketItem } from "../QuoteBuilderTab";

interface BasketCanvasProps {
  baskets: Basket[];
  onAddBasket: () => void;
  onRenameBasket: (id: string, name: string) => void;
  onRemoveBasket: (id: string) => void;
  onRemoveItem: (basketId: string, instanceId: string) => void;
  onUpdateQuantity: (basketId: string, instanceId: string, qty: number) => void;
}

function DroppableBasket({
  basket,
  onRename,
  onRemove,
  onRemoveItem,
  onUpdateQuantity,
}: {
  basket: Basket;
  onRename: (name: string) => void;
  onRemove: () => void;
  onRemoveItem: (instanceId: string) => void;
  onUpdateQuantity: (instanceId: string, qty: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(basket.name);

  const subtotal = basket.items.reduce(
    (s, i) => s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity,
    0
  );

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      {/* Basket header */}
      <div className="flex items-center justify-between p-2 border-b border-border/50">
        {editing ? (
          <div className="flex items-center gap-1 flex-1">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-6 text-xs w-32"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(editName);
                  setEditing(false);
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                onRename(editName);
                setEditing(false);
              }}
            >
              <Check className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary transition-colors"
            onClick={() => setEditing(true)}
          >
            {basket.name}
            <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-muted-foreground">
            R{subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-destructive/60 hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Items */}
      <div className="p-2 min-h-[60px] space-y-1">
        {basket.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <Package className="h-5 w-5 mb-1 opacity-40" />
            <p className="text-[10px]">Drop products here</p>
          </div>
        ) : (
          basket.items.map((item) => (
            <BasketItemCard
              key={item.instanceId}
              item={item}
              onRemove={() => onRemoveItem(item.instanceId)}
              onUpdateQuantity={(qty) => onUpdateQuantity(item.instanceId, qty)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BasketItemCard({
  item,
  onRemove,
  onUpdateQuantity,
}: {
  item: BasketItem;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
}) {
  const price = item.product.selling_price || item.product.cost_incl_vat || 0;
  const lineTotal = price * item.quantity;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">
          {item.product.brand} {item.product.short_name || item.product.product_code}
        </p>
        <p className="text-[10px] text-muted-foreground">
          R{price.toLocaleString("en-ZA")} each
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="outline"
          size="icon"
          className="h-5 w-5"
          onClick={() => onUpdateQuantity(item.quantity - 1)}
          disabled={item.quantity <= 1}
        >
          <Minus className="h-2.5 w-2.5" />
        </Button>
        <span className="w-6 text-center font-semibold text-xs">{item.quantity}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-5 w-5"
          onClick={() => onUpdateQuantity(item.quantity + 1)}
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </div>
      <span className="text-xs font-bold w-16 text-right shrink-0">
        R{lineTotal.toLocaleString("en-ZA")}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-destructive/60 hover:text-destructive shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

const BasketCanvas = ({
  baskets,
  onAddBasket,
  onRenameBasket,
  onRemoveBasket,
  onRemoveItem,
  onUpdateQuantity,
}: BasketCanvasProps) => {
  return (
    <div className="flex flex-col rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold text-foreground">Quote Canvas</h3>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onAddBasket}>
          <Plus className="h-3 w-3" /> Add Zone
        </Button>
      </div>

      <ScrollArea className="flex-1" style={{ maxHeight: 420 }}>
        <div className="p-3 space-y-3">
          {baskets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No zones yet</p>
              <p className="text-xs">Click "Add Zone" to get started</p>
            </div>
          ) : (
            baskets.map((basket) => (
              <DroppableBasket
                key={basket.id}
                basket={basket}
                onRename={(name) => onRenameBasket(basket.id, name)}
                onRemove={() => onRemoveBasket(basket.id)}
                onRemoveItem={(instanceId) => onRemoveItem(basket.id, instanceId)}
                onUpdateQuantity={(instanceId, qty) => onUpdateQuantity(basket.id, instanceId, qty)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default BasketCanvas;
