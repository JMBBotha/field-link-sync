import { useState, useMemo, useCallback } from "react";
import { Search, Check, ChevronDown, ChevronUp, Star, Info, X, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit } from "../quoteWizardTypes";
import { detectBTU, getBracketSize } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  products: PaletteProduct[];
  onPdfSearch?: (term: string) => void;
}

function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function PinnedStar({ pinned }: { pinned: boolean }) {
  return pinned ? (
    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500 shrink-0" />
  ) : null;
}

/* ─── Product Info Popover (Bug 2 fix) ─── */
function ProductInfoPopover({ product }: { product: PaletteProduct }) {
  const btu = detectBTU(product);
  const costPrice = product.cost_excl_vat || 0;
  const sellingPrice = product.selling_price || 0;
  const currentMarkup = costPrice > 0 ? ((sellingPrice - costPrice) / costPrice) * 100 : 0;

  const [markup, setMarkup] = useState(Math.round(currentMarkup * 100) / 100);
  const [saving, setSaving] = useState(false);

  const handleSaveMarkup = async () => {
    if (costPrice <= 0) return;
    setSaving(true);
    const newSelling = costPrice * (1 + markup / 100);
    const { error } = await supabase
      .from("supplier_products")
      .update({ selling_price: Math.round(newSelling * 100) / 100 })
      .eq("id", product.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to update markup");
    } else {
      toast.success("Markup updated");
      // Update local product object for immediate feedback
      product.selling_price = Math.round(newSelling * 100) / 100;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-accent shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-xs space-y-2"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="font-semibold text-sm">{product.short_name || product.product_code}</p>
        <Separator />
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground">Model</span>
          <span className="font-medium">{product.product_code}</span>
          <span className="text-muted-foreground">Brand</span>
          <span>{product.brand}</span>
          <span className="text-muted-foreground">BTU Rating</span>
          <span>{btu.toLocaleString()}</span>
          {product.pipe_size && (<>
            <span className="text-muted-foreground">Pipe Sizes</span>
            <span>{product.pipe_size}</span>
          </>)}
          <span className="text-muted-foreground">Description</span>
          <span className="break-words">{product.description || "—"}</span>
          <span className="text-muted-foreground">Supplier</span>
          <span>{product.supplier_name || "—"}</span>
        </div>
        <Separator />
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground">Cost Price</span>
          <span>{formatZAR(costPrice)}</span>
          <span className="text-muted-foreground">Selling Price</span>
          <span className="font-medium">{formatZAR(sellingPrice)}</span>
        </div>
        <Separator />
        <div className="space-y-1.5">
          <Label className="text-xs">Markup %</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={markup}
              onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)}
              className="h-7 text-xs w-20"
              step={1}
              min={0}
            />
            <span className="text-muted-foreground text-xs">
              → {formatZAR(costPrice * (1 + markup / 100))}
            </span>
            <button
              className="ml-auto text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSaveMarkup}
              disabled={saving || costPrice <= 0}
            >
              {saving ? "..." : "Save"}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Per-area search dropdown ─── */
function AreaUnitSelector({
  area,
  acProducts,
  onSelect,
  onRemove,
}: {
  area: QuoteArea;
  acProducts: PaletteProduct[];
  onSelect: (areaId: string, product: PaletteProduct) => void;
  onRemove: (areaId: string, idx: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return acProducts.slice(0, 20);
    const terms = query.toLowerCase().split(/\s+/);
    return acProducts.filter((p) => {
      const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
      return terms.every((t) => blob.includes(t));
    }).slice(0, 30);
  }, [acProducts, query]);

  const selectedUnit = area.acUnits[0] || null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{area.name}</span>
        {selectedUnit && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <Check className="h-3 w-3 text-green-600" />
            Unit selected
          </Badge>
        )}
      </div>

      {/* Currently selected unit */}
      {selectedUnit && (
        <div className="flex items-center gap-2 rounded border border-green-500/30 bg-green-500/5 px-2.5 py-2 text-xs">
          <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <PinnedStar pinned={!!(selectedUnit.product as any).is_pinned} />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{selectedUnit.product.product_code}</div>
            <div className="text-muted-foreground flex gap-1 flex-wrap">
              <span className="truncate">{selectedUnit.product.short_name || selectedUnit.product.product_code}</span>
              <span>·</span>
              <span>{selectedUnit.btu.toLocaleString()} BTU</span>
              {selectedUnit.product.pipe_size && (<><span>·</span><span>{selectedUnit.product.pipe_size}</span></>)}
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                Bracket: {getBracketSize(selectedUnit.btu)}
              </Badge>
            </div>
          </div>
          <span className="text-xs font-medium shrink-0">
            {formatZAR(selectedUnit.product.selling_price || selectedUnit.product.cost_incl_vat || 0)}
          </span>
          <ProductInfoPopover product={selectedUnit.product} />
          <button
            className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20 shrink-0"
            onClick={() => onRemove(area.id, 0)}
          >
            <X className="h-3 w-3 text-destructive" />
          </button>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search AC units for this area..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
          className="pl-7 h-8 text-xs"
        />
      </div>

      {/* Dropdown results */}
      {dropdownOpen && (
        <div className="max-h-40 overflow-y-auto space-y-0.5 rounded border p-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No AC products found</p>
          ) : (
            filtered.map((p) => {
              const btu = detectBTU(p);
              const isSelected = selectedUnit?.product.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left ${isSelected ? "bg-accent ring-1 ring-primary" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(area.id, p);
                    setDropdownOpen(false);
                    setQuery("");
                  }}
                >
                  {isSelected && <Check className="h-3 w-3 text-green-600 shrink-0" />}
                  <PinnedStar pinned={!!(p as any).is_pinned} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.product_code}</div>
                    <div className="text-muted-foreground truncate">
                      {p.short_name || p.product_code} · {btu.toLocaleString()} BTU{p.pipe_size ? ` · ${p.pipe_size}` : ""}
                    </div>
                  </div>
                  <span className="font-medium shrink-0">
                    {formatZAR(p.selling_price || p.cost_incl_vat || 0)}
                  </span>
                  <ProductInfoPopover product={p} />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Step Component ─── */
export default function ACSelectionStep({ areas, onAreasChange, products, onPdfSearch }: Props) {
  const acProducts = useMemo(() => {
    let filtered = products.filter(
      (p) => p.product_category === "Air Conditioning" || (p.category || "").toLowerCase().includes("air conditioning")
    );
    filtered = filtered.filter((p) => {
      const st = (p as any).supplier_type || "both";
      return st === "ac_units" || st === "ac_equipment" || st === "both";
    });
    filtered = filtered.filter((p) => !p.is_material_favorite);
    return filtered;
  }, [products]);

  const handleSelect = useCallback((areaId: string, product: PaletteProduct) => {
    const btu = detectBTU(product);
    const newUnit: AreaACUnit = { id: crypto.randomUUID(), product, btu, quantity: 1 };
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        // Replace the unit for this area (single unit per area)
        return { ...a, acUnits: [newUnit] };
      })
    );
  }, [areas, onAreasChange]);

  const handleRemove = useCallback((areaId: string, idx: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, acUnits: a.acUnits.filter((_, i) => i !== idx) };
      })
    );
  }, [areas, onAreasChange]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select an AC unit for each area. Each area has its own search bar — selections are independent.
      </p>

      <div className="space-y-3">
        {areas.map((area) => (
          <AreaUnitSelector
            key={area.id}
            area={area}
            acProducts={acProducts}
            onSelect={handleSelect}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </div>
  );
}
