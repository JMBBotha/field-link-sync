import { useState, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus, Trash2, Pencil, Check, Package, ShoppingBag, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SharedBasketItemCard } from "@/components/shared/SharedBasketItems";
import ZoneBundleSection from "./ZoneBundleSection";
import ZoneTemplateSelector from "./ZoneTemplateSelector";
import type { Basket, PaletteProduct } from "../QuoteBuilderTab";
import { calculateBasketSubtotal } from "@/utils/basketCalc";

interface BasketCanvasProps {
  baskets: Basket[];
  allProducts: PaletteProduct[];
  dbBundles?: Array<{ id: string; name: string; min_btu?: number | null; max_btu?: number | null; items: any[] }>;
  onAddBasket: () => void;
  onRenameBasket: (id: string, name: string) => void;
  onRemoveBasket: (id: string) => void;
  onRemoveItem: (basketId: string, instanceId: string) => void;
  onUpdateQuantity: (basketId: string, instanceId: string, qty: number) => void;
  onUpdateLength: (basketId: string, instanceId: string, length: number) => void;
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  onAddBundleToBasket?: (basketId: string, bundle: any) => void;
  onDuplicateBasket: (id: string) => void;
  onApplyTemplate: (zones: string[]) => void;
  onClearAll: () => void;
  isDragging?: boolean;
  isCompact?: boolean;
  areaBuilderNode?: React.ReactNode;
  areaAddZone?: () => void;
  areaApplyTemplate?: (zones: string[]) => void;
  areaClearAll?: () => void;
  areaCount?: number;
}

function DroppableBasket({
  basket,
  allProducts,
  dbBundles,
  onRename,
  onRemove,
  onDuplicate,
  onRemoveItem,
  onUpdateQuantity,
  onUpdateLength,
  onAddProduct,
  onAddBundle,
  isDragActive,
  isCompact,
}: {
  basket: Basket;
  allProducts: PaletteProduct[];
  dbBundles?: Array<{ id: string; name: string; min_btu?: number | null; max_btu?: number | null; items: any[] }>;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onRemoveItem: (instanceId: string) => void;
  onUpdateQuantity: (instanceId: string, qty: number) => void;
  onUpdateLength: (instanceId: string, length: number) => void;
  onAddProduct: (product: PaletteProduct) => void;
  onAddBundle?: (bundle: any) => void;
  isDragActive?: boolean;
  isCompact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: basket.id });
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(basket.name);

  const subtotal = calculateBasketSubtotal(basket.items);
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
            <Button variant="ghost" size="icon" className="h-5 w-5"
              onClick={() => { onRename(editName); setEditing(false); }}>
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

      {/* Items — keyed by instanceId (stable) */}
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
              <SharedBasketItemCard
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
  areaBuilderNode,
  areaAddZone,
  areaApplyTemplate,
  areaClearAll,
  areaCount = 0,
}: BasketCanvasProps) => {
  const hasAreaBuilder = !!areaBuilderNode;
  const effectiveAddZone = hasAreaBuilder && areaAddZone ? areaAddZone : onAddBasket;
  const effectiveApplyTemplate = hasAreaBuilder && areaApplyTemplate ? areaApplyTemplate : onApplyTemplate;
  const effectiveClearAll = hasAreaBuilder && areaClearAll ? areaClearAll : onClearAll;
  const showClearAll = hasAreaBuilder ? areaCount > 0 : baskets.length > 0;

  return (
    <div className="flex flex-col h-full rounded-lg border bg-muted/30 overflow-hidden">
      <div className={`flex items-center justify-between border-b shrink-0 ${isCompact ? "px-2 py-1.5" : "p-3"}`}>
        <h3 className={`font-semibold text-foreground ${isCompact ? "text-xs" : "text-sm"}`}>
          {isCompact ? "Zones" : "Build Area Quote"}
        </h3>
        <div className="flex items-center gap-1">
          {showClearAll && (
            <Button variant="ghost" size="sm" className={`gap-0.5 text-destructive hover:text-destructive ${isCompact ? "h-6 text-[10px] px-1.5" : "h-7 text-xs"}`} onClick={effectiveClearAll}>
              <Trash2 className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
              {!isCompact && "Clear All"}
            </Button>
          )}
          {!isCompact && <ZoneTemplateSelector onApplyTemplate={effectiveApplyTemplate} />}
          <Button variant="outline" size="sm" className={`gap-0.5 ${isCompact ? "h-6 text-[10px] px-1.5" : "h-7 text-xs"}`} onClick={effectiveAddZone}>
            <Plus className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
            {isCompact ? "Zone" : "Add Zone"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0" style={{ scrollBehavior: "smooth" as any }}>
        {areaBuilderNode && (
          <div className="px-[5px] py-2">
            {areaBuilderNode}
          </div>
        )}

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
      </div>
    </div>
  );
};

export default BasketCanvas;
