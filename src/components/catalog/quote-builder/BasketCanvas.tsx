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
      <div className="flex items-center justify-between p-2.5 border-b border-border/50">
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
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
            onClick={() => setEditing(true)}
          >
            <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
            {basket.name}
            <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
          </button>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {basket.items.length} item{basket.items.length !== 1 ? "s" : ""} · {totalQty} qty
          </span>
          <span className="text-xs font-bold text-foreground">
            R{subtotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={onDuplicate}
            title="Duplicate zone"
          >
            <Copy className="h-3 w-3" />
          </Button>
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
      <div className="p-2 space-y-1.5" style={{ minHeight: 120 }}>
        {basket.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-6 rounded-md transition-colors ${
            isOver ? "bg-primary/10 text-primary" : isDragActive ? "bg-muted/50 text-muted-foreground" : "text-muted-foreground"
          }`}>
            <Package className={`h-6 w-6 mb-1 ${isOver ? "opacity-80" : "opacity-40"}`} />
            <p className="text-xs font-medium">{isOver ? "Release to drop" : isDragActive ? "Drop products here" : "Drop products here"}</p>
          </div>
        ) : (
          <>
            {basket.items.map((item) => (
              <BasketItemCard
                key={item.instanceId}
                item={item}
                onRemove={() => onRemoveItem(item.instanceId)}
                onUpdateQuantity={(qty) => onUpdateQuantity(item.instanceId, qty)}
                onUpdateLength={(len) => onUpdateLength(item.instanceId, len)}
              />
            ))}
            {/* Consumables auto-suggest */}
            <ConsumablesSuggestionPanel
              basketItems={basket.items}
              allProducts={allProducts}
              onAddProduct={onAddProduct}
            />
          </>
        )}
      </div>
    </div>
  );
}

function BasketItemCard({
  item,
  onRemove,
  onUpdateQuantity,
  onUpdateLength,
}: {
  item: BasketItem;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
  onUpdateLength: (length: number) => void;
}) {
  const isLengthItem = item.product.sold_in_length && !!item.product.price_per_metre;
  const price = isLengthItem
    ? (item.product.price_per_metre || 0) * (item.length || 1)
    : (item.product.selling_price || item.product.cost_incl_vat || 0) * item.quantity;
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
      )}
      <span className="text-xs font-bold w-16 text-right shrink-0">
        R{price.toLocaleString("en-ZA")}
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
}: BasketCanvasProps) => {
  return (
    <div className="flex flex-col rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold text-foreground">Quote Canvas</h3>
        <div className="flex items-center gap-1.5">
          {baskets.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={onClearAll}>
              <Trash2 className="h-3 w-3" /> Clear All
            </Button>
          )}
          <ZoneTemplateSelector onApplyTemplate={onApplyTemplate} />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onAddBasket}>
            <Plus className="h-3 w-3" /> Add Zone
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <div className="p-3 space-y-3">
          {baskets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No zones yet</p>
              <p className="text-xs">Click "Add Zone" or use a template</p>
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
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default BasketCanvas;
