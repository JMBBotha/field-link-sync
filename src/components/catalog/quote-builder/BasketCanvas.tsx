import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Trash2, Pencil, Check, Minus, Package, ShoppingBag, Copy, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { getCategoryIcon, getCategoryBg } from "./ProductPalette";
import { getProductDisplayName } from "./productDisplayUtils";
import ConsumablesSuggestionPanel from "./ConsumablesSuggestionPanel";
import ZoneTemplateSelector from "./ZoneTemplateSelector";
import type { Basket, BasketItem, PaletteProduct } from "../QuoteBuilderTab";

interface BasketCanvasProps {
  baskets: Basket[];
  allProducts: PaletteProduct[];
  onAddBasket: () => void;
  onRenameBasket: (id: string, name: string) => void;
  onRemoveBasket: (id: string) => void;
  onRemoveItem: (basketId: string, instanceId: string) => void;
  onUpdateQuantity: (basketId: string, instanceId: string, qty: number) => void;
  onUpdateLength: (basketId: string, instanceId: string, length: number) => void;
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  onDuplicateBasket: (id: string) => void;
  onApplyTemplate: (zones: string[]) => void;
  onClearAll: () => void;
  isDragging?: boolean;
  isCompact?: boolean;
}

function DroppableBasket({
  basket,
  allProducts,
  onRename,
  onRemove,
  onDuplicate,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateLength,
  onAddProduct,
  isDragActive,
  isCompact,
}: {
  basket: Basket;
  allProducts: PaletteProduct[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onRemoveItem: (instanceId: string) => void;
  onUpdateQuantity: (instanceId: string, qty: number) => void;
  onUpdateLength: (instanceId: string, length: number) => void;
  onAddProduct: (product: PaletteProduct) => void;
  isDragActive?: boolean;
  isCompact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(basket.name);

  const subtotal = basket.items.reduce((s, i) => {
    if (i.product.sold_in_length && i.product.price_per_metre && i.length) {
      return s + i.product.price_per_metre * i.length;
    }
    return s + (i.product.selling_price || i.product.cost_incl_vat || 0) * i.quantity;
  }, 0);

  const totalQty = basket.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed transition-all duration-200 ${
        isOver
          ? "border-primary bg-primary/10 shadow-lg ring-2 ring-primary/20"
          : isDragActive
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      {/* Basket header */}
      <div className={`flex items-center justify-between border-b border-border/50 ${isCompact ? "px-1.5 py-1" : "p-2.5"}`}>
        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-5 text-[10px] w-20 px-1"
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
              className="h-5 w-5"
              onClick={() => {
                onRename(editName);
                setEditing(false);
              }}
            >
              <Check className="h-2.5 w-2.5" />
            </Button>
          </div>
        ) : (
          <button
            className={`flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors truncate min-w-0 ${isCompact ? "text-[10px]" : "text-xs"}`}
            onClick={() => setEditing(true)}
          >
            <ShoppingBag className={isCompact ? "h-3 w-3 shrink-0 text-muted-foreground" : "h-3.5 w-3.5 shrink-0 text-muted-foreground"} />
            <span className="truncate">{basket.name}</span>
            <Pencil className="h-2 w-2 shrink-0 text-muted-foreground" />
          </button>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className={`text-muted-foreground whitespace-nowrap ${isCompact ? "text-[8px]" : "text-[10px]"}`}>
            {basket.items.length}·{totalQty}
          </span>
          <span className={`font-bold text-foreground whitespace-nowrap ${isCompact ? "text-[10px]" : "text-xs"}`}>
            R{subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground hover:text-foreground" onClick={onDuplicate} title="Duplicate zone">
            <Copy className="h-2.5 w-2.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive/60 hover:text-destructive" onClick={onRemove}>
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Items */}
      <div className={`space-y-1 ${isCompact ? "p-1" : "p-2"}`} style={{ minHeight: isCompact ? 60 : 120 }}>
        {basket.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center rounded-md transition-colors ${isCompact ? "py-3" : "py-6"} ${
            isOver ? "bg-primary/10 text-primary" : isDragActive ? "bg-muted/50 text-muted-foreground" : "text-muted-foreground"
          }`}>
            <Package className={`${isCompact ? "h-4 w-4" : "h-6 w-6"} mb-1 ${isOver ? "opacity-80" : "opacity-40"}`} />
            <p className={`font-medium ${isCompact ? "text-[10px]" : "text-xs"}`}>{isOver ? "Release to drop" : "Drop products here"}</p>
          </div>
        ) : (
          <>
            {basket.items.map((item) => (
              <BasketItemCard
                key={item.instanceId}
                item={item}
                isCompact={isCompact}
                onRemove={() => onRemoveItem(item.instanceId)}
                onUpdateQuantity={(qty) => onUpdateQuantity(item.instanceId, qty)}
                onUpdateLength={(len) => onUpdateLength(item.instanceId, len)}
              />
            ))}
            {!isCompact && (
              <ConsumablesSuggestionPanel
                basketItems={basket.items}
                allProducts={allProducts}
                onAddProduct={onAddProduct}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BasketItemCard({
  item,
  isCompact,
  onRemove,
  onUpdateQuantity,
  onUpdateLength,
}: {
  item: BasketItem;
  isCompact?: boolean;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
  onUpdateLength: (length: number) => void;
}) {
  const isLengthItem = item.product.sold_in_length && !!item.product.price_per_metre;
  const price = isLengthItem
    ? (item.product.price_per_metre || 0) * (item.length || 1)
    : (item.product.selling_price || item.product.cost_incl_vat || 0) * item.quantity;

  if (isCompact) {
    return (
      <div className="flex items-center gap-1 rounded border bg-background px-1 py-0.5 text-[10px]">
        <div className="min-w-0 flex-1 truncate font-medium">
          {getProductDisplayName(item.product)}
        </div>
        {isLengthItem ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Input
              type="number"
              min={0.1}
              step={0.5}
              value={item.length || 1}
              onChange={(e) => onUpdateLength(parseFloat(e.target.value) || 0.1)}
              className="h-4 w-10 text-[10px] text-center px-0.5"
            />
            <span className="text-[8px] text-muted-foreground">m</span>
          </div>
        ) : (
          <div className="flex items-center gap-0 shrink-0">
            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => onUpdateQuantity(item.quantity - 1)} disabled={item.quantity <= 1}>
              <Minus className="h-2 w-2" />
            </Button>
            <span className="w-4 text-center font-semibold">{item.quantity}</span>
            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => onUpdateQuantity(item.quantity + 1)}>
              <Plus className="h-2 w-2" />
            </Button>
          </div>
        )}
        <span className="font-bold w-12 text-right shrink-0">
          R{price.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
        </span>
        <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive/60 hover:text-destructive shrink-0" onClick={onRemove}>
          <Trash2 className="h-2 w-2" />
        </Button>
      </div>
    );
  }

  const catBg = getCategoryBg(item.product.product_category);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-1.5 text-xs">
      <div className={`shrink-0 rounded p-1 ${catBg}`}>
        {getCategoryIcon(item.product.product_category, "h-3 w-3")}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">
          {getProductDisplayName(item.product)}
        </p>
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] font-mono font-medium text-primary/80 truncate">
            {item.product.product_code}
          </p>
          {isLengthItem && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 gap-0.5 border-orange-400/40 text-orange-600">
              <Ruler className="h-2 w-2" />
              R{(item.product.price_per_metre || 0).toFixed(2)}/m
            </Badge>
          )}
        </div>
      </div>
      {isLengthItem ? (
        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number"
            min={0.1}
            step={0.5}
            value={item.length || 1}
            onChange={(e) => onUpdateLength(parseFloat(e.target.value) || 0.1)}
            className="h-6 w-14 text-xs text-center px-1"
          />
          <span className="text-[10px] text-muted-foreground">m</span>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => onUpdateQuantity(item.quantity - 1)} disabled={item.quantity <= 1}>
            <Minus className="h-2.5 w-2.5" />
          </Button>
          <span className="w-6 text-center font-semibold text-xs">{item.quantity}</span>
          <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => onUpdateQuantity(item.quantity + 1)}>
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}
      <span className="text-xs font-bold w-16 text-right shrink-0">
        R{price.toLocaleString("en-ZA")}
      </span>
      <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive/60 hover:text-destructive shrink-0" onClick={onRemove}>
        <Trash2 className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

const BasketCanvas = ({
  baskets,
  allProducts,
  onAddBasket,
  onRenameBasket,
  onRemoveBasket,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateLength,
  onAddProductToBasket,
  onDuplicateBasket,
  onApplyTemplate,
  onClearAll,
  isDragging,
  isCompact,
}: BasketCanvasProps) => {
  return (
    <div className="flex flex-col rounded-lg border bg-muted/30 overflow-hidden">
      <div className={`flex items-center justify-between border-b ${isCompact ? "px-2 py-1.5" : "p-3"}`}>
        <h3 className={`font-semibold text-foreground ${isCompact ? "text-xs" : "text-sm"}`}>
          {isCompact ? "Zones" : "Quote Canvas"}
        </h3>
        <div className="flex items-center gap-1">
          {baskets.length > 0 && (
            <Button variant="ghost" size="sm" className={`gap-0.5 text-destructive hover:text-destructive ${isCompact ? "h-6 text-[10px] px-1.5" : "h-7 text-xs"}`} onClick={onClearAll}>
              <Trash2 className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
              {!isCompact && "Clear All"}
            </Button>
          )}
          {!isCompact && <ZoneTemplateSelector onApplyTemplate={onApplyTemplate} />}
          <Button variant="outline" size="sm" className={`gap-0.5 ${isCompact ? "h-6 text-[10px] px-1.5" : "h-7 text-xs"}`} onClick={onAddBasket}>
            <Plus className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
            {isCompact ? "Zone" : "Add Zone"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1" style={{ maxHeight: "calc(100vh - 300px)", scrollBehavior: "smooth" as any }}>
        <div className={`${isCompact ? "p-1.5 space-y-1.5" : "p-3 space-y-3"}`}>
          {baskets.length === 0 ? (
            <div className={`flex flex-col items-center justify-center text-muted-foreground ${isCompact ? "py-6" : "py-12"}`}>
              <Package className={`mb-2 opacity-30 ${isCompact ? "h-5 w-5" : "h-8 w-8"}`} />
              <p className={isCompact ? "text-[10px]" : "text-sm"}>No zones yet</p>
              <p className={isCompact ? "text-[9px]" : "text-xs"}>Click "Add Zone" or use a template</p>
            </div>
          ) : (
            baskets.map((basket) => (
              <DroppableBasket
                key={basket.id}
                basket={basket}
                allProducts={allProducts}
                onRename={(name) => onRenameBasket(basket.id, name)}
                onRemove={() => onRemoveBasket(basket.id)}
                onDuplicate={() => onDuplicateBasket(basket.id)}
                onRemoveItem={(instanceId) => onRemoveItem(basket.id, instanceId)}
                onUpdateQuantity={(instanceId, qty) => onUpdateQuantity(basket.id, instanceId, qty)}
                onUpdateLength={(instanceId, len) => onUpdateLength(basket.id, instanceId, len)}
                onAddProduct={(product) => onAddProductToBasket(basket.id, product)}
                isDragActive={isDragging}
                isCompact={isCompact}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default BasketCanvas;
