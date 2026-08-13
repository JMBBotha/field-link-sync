import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, Check, Star, X, Zap, Package, ImageIcon, Plus, Trash2, Ruler, Hash, MousePointerClick, ChevronDown, ChevronUp, Wrench, TrendingUp } from "lucide-react";
import { getProductPricing, stripVat } from "@/lib/pricing";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import ProductInfoDialog from "@/components/shared/ProductInfoDialog";
import QuantityControl from "../QuantityControl";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit, AreaConsumable, AreaMaterial } from "../quoteWizardTypes";
import { detectBTU, getBracketSize } from "../quoteWizardTypes";
import { findDaikinRemote, forcePerUnitPricing, isWiredRemote } from "../daikinRemoteUtils";
import { getProductDisplayName } from "../productDisplayUtils";
import { computeLineTotal, resolvePricingUnit, formatUnitPrice } from "@/lib/pricingUnits";
import { toast } from "sonner";

/** Single source of truth for a bundle/material/consumable unit price. */
function unitPriceOf(product: any): number {
  return product?.cost_price || product?.cost_excl_vat || product?.price_per_metre || product?.selling_price || 0;
}

/** lineTotal for any area line, honouring the product's pricing unit (per 100, per roll, ...) */
function lineTotalOf(product: any, qty: number): number {
  return computeLineTotal(qty, unitPriceOf(product), resolvePricingUnit(product));
}


interface PaletteBundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  min_btu?: number | null;
  max_btu?: number | null;
  compatible_brands?: string[] | null;
  is_favorite?: boolean;
  items: any[];
}

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  products: PaletteProduct[];
  bundles?: PaletteBundle[];
  onPdfSearch?: (term: string) => void;
}

function formatZAR(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function PinnedStar({ pinned }: { pinned: boolean }) {
  return pinned ? (
    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500 shrink-0" />
  ) : null;
}

/** Small product thumbnail */
function ProductThumb({ product }: { product: PaletteProduct }) {
  const url = (product as any).image_url;
  if (!url) return <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0"><ImageIcon className="h-4 w-4 text-muted-foreground/40" /></div>;
  return (
    <img
      src={url}
      alt={product.short_name || product.product_code}
      className="h-10 w-10 rounded object-cover border border-border shrink-0"
      loading="lazy"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/* ─── Helper: find best matching bundle for a given BTU/brand ─── */
function findSuggestedBundle(btu: number, brand: string, bundles: PaletteBundle[]): PaletteBundle | null {
  if (bundles.length === 0) return null;
  const brandLower = brand.toLowerCase();
  let best: PaletteBundle | null = null;
  let bestScore = -1;
  for (const b of bundles) {
    let score = 0;
    if (b.min_btu != null && b.max_btu != null) {
      if (btu >= b.min_btu && btu <= b.max_btu) score += 10;
      else continue;
    }
    if (b.compatible_brands && b.compatible_brands.length > 0) {
      if (b.compatible_brands.some((cb) => cb.toLowerCase() === brandLower)) score += 5;
      else continue;
    }
    const text = [b.name, b.description].filter(Boolean).join(" ").toLowerCase();
    const kw = Math.round(btu / 1000);
    if (text.includes(`${kw}k`) || text.includes(`${kw}kw`)) score += 3;
    if (b.is_favorite) score += 2;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/* ─── Suggested Bundle Interactive Panel ─── */
function SuggestedBundlePanel({
  bundle,
  area,
  onApplyBundle,
  onDismissBundle,
}: {
  bundle: PaletteBundle;
  area: QuoteArea;
  onApplyBundle: (areaId: string, bundle: PaletteBundle, itemOverrides: Record<string, { qty: number; mode: "unit" | "length" }>) => void;
  onDismissBundle: (areaId: string) => void;
}) {
  const isApplied = area.appliedBundleId === bundle.id;
  const [itemOverrides, setItemOverrides] = useState<Record<string, { qty: number; mode: "unit" | "length" }>>(() => {
    const init: Record<string, { qty: number; mode: "unit" | "length" }> = {};
    for (const item of bundle.items) {
      const isLen = item.is_length_item;
      init[item.id] = { qty: isLen ? (item.length_metres || 3) : (item.quantity || 1), mode: isLen ? "length" : "unit" };
    }
    return init;
  });

  const updateItem = (itemId: string, updates: Partial<{ qty: number; mode: "unit" | "length" }>) => {
    setItemOverrides((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...updates } }));
  };

  // Once applied, the area's Materials & Consumables list is the source of truth —
  // the item editor stays collapsed unless the user opts into adjusting the kit.
  const [editorOpen, setEditorOpen] = useState(!isApplied);
  useEffect(() => { if (isApplied) setEditorOpen(false); }, [isApplied]);

  const activeItems = bundle.items.filter((i: any) => !i.is_optional);
  const kitTotal = activeItems.reduce((sum: number, item: any) => {
    const product = item.product || item.supplier_product;
    if (!product) return sum;
    const override = itemOverrides[item.id] || { qty: item.quantity || 1, mode: item.is_length_item ? "length" : "unit" };
    return sum + lineTotalOf(product, override.qty);
  }, 0);

  const formatZAR2 = (v: number) => `R${v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-medium text-foreground flex-1">{bundle.name}</span>
        <Badge variant="secondary" className="text-[10px]">{activeItems.length} items</Badge>
        {isApplied ? (
          <Badge variant="default" className="text-[10px] gap-1">
            <Check className="h-2.5 w-2.5" /> Applied
          </Badge>
        ) : null}
      </div>

      {isApplied && !editorOpen && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Kit items are listed under Materials &amp; Consumables.</span>
          <span className="font-medium text-foreground">{formatZAR2(kitTotal)}</span>
        </div>
      )}

      {/* Item list with qty/length controls */}
      {editorOpen && (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {activeItems.map((item: any) => {
          const product = item.product || item.supplier_product;
          const override = itemOverrides[item.id] || { qty: item.quantity || 1, mode: item.is_length_item ? "length" : "unit" };
          const name = product ? (getProductDisplayName(product) || product.product_code || "Item") : (item.notes || "Item");
          const unit = resolvePricingUnit(product);

          return (
            <div key={item.id} className="flex items-center gap-2 rounded border border-border/50 bg-background/50 px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-foreground">{name}</div>
                <div className="text-muted-foreground text-[10px]">
                  {formatUnitPrice(unitPriceOf(product), unit)} · {formatZAR2(lineTotalOf(product, override.qty))}
                </div>
              </div>

              {/* Mode toggle */}
              <button
                type="button"
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] border border-border hover:bg-accent transition-colors"
                onClick={() => updateItem(item.id, { mode: override.mode === "length" ? "unit" : "length" })}
              >
                {override.mode === "length" ? <><Ruler className="h-2.5 w-2.5" /> p/m</> : <><Hash className="h-2.5 w-2.5" /> qty</>}
              </button>

              {/* Qty/length control */}
              <QuantityControl
                value={override.qty}
                onChange={(v) => updateItem(item.id, { qty: v })}
                min={override.mode === "length" ? 0.5 : 1}
                max={override.mode === "length" ? 100 : 50}
                step={override.mode === "length" ? 0.5 : 1}
                showSlider={false}
                suffix={override.mode === "length" ? "m" : ""}
                size="sm"
                className="shrink-0"
              />
            </div>
          );
        })}
      </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        {!isApplied ? (
          <Button
            size="sm"
            className="h-7 text-xs gap-1 flex-1"
            onClick={() => onApplyBundle(area.id, bundle, itemOverrides)}
          >
            <Plus className="h-3 w-3" /> Apply Kit
          </Button>
        ) : editorOpen ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 flex-1"
            onClick={() => { onApplyBundle(area.id, bundle, itemOverrides); setEditorOpen(false); }}
          >
            <Check className="h-3 w-3" /> Update Kit
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 flex-1"
            onClick={() => setEditorOpen(true)}
          >
            <Wrench className="h-3 w-3" /> Adjust Kit
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
          onClick={() => onDismissBundle(area.id)}
        >
          <Trash2 className="h-3 w-3" /> {isApplied ? "Remove" : "Dismiss"}
        </Button>
      </div>
    </div>

  );
}

/* ─── Per-area search dropdown ─── */
function AreaUnitSelector({
  area,
  acProducts,
  onSelect,
  onRemove,
  onRemoveConsumable,
  onRemoveMaterial,
  suggestedBundle,
  onApplyBundle,
  onDismissBundle,
}: {
  area: QuoteArea;
  acProducts: PaletteProduct[];
  onSelect: (areaId: string, product: PaletteProduct) => void;
  onRemove: (areaId: string, idx: number) => void;
  onRemoveConsumable: (areaId: string, consumableId: string) => void;
  onRemoveMaterial: (areaId: string, materialId: string) => void;
  suggestedBundle?: PaletteBundle | null;
  onApplyBundle: (areaId: string, bundle: PaletteBundle, overrides: Record<string, { qty: number; mode: "unit" | "length" }>) => void;
  onDismissBundle: (areaId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return acProducts.slice(0, 20);
    const terms = debouncedQuery.toLowerCase().split(/\s+/);
    return acProducts.filter((p) => {
      const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
      return terms.every((t) => blob.includes(t));
    }).slice(0, 30);
  }, [acProducts, debouncedQuery]);

  const selectedUnit = area.acUnits[0] || null;
  const totalExtras = (area.consumables?.length || 0) + (area.materials?.length || 0);

  // Auto-expand when items are added
  const [expanded, setExpanded] = useState(totalExtras > 0);
  const prevExtrasRef = useRef(totalExtras);
  useEffect(() => {
    if (totalExtras > prevExtrasRef.current) {
      setExpanded(true);
    }
    prevExtrasRef.current = totalExtras;
  }, [totalExtras]);

  const { setNodeRef, isOver } = useDroppable({
    id: `wizard-area-${area.id}`,
    data: { areaId: area.id, type: "wizard-area" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-card p-3 space-y-2 shadow-md hover:shadow-lg transition-all ${selectedUnit ? "border-l-2 border-l-amber-400" : ""} ${isOver ? "ring-2 ring-primary border-primary bg-primary/5" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{area.name}</span>
        <div className="flex items-center gap-1.5">
          {isOver && (
            <Badge variant="default" className="text-[10px] gap-1 animate-pulse">
              <MousePointerClick className="h-3 w-3" /> Drop here
            </Badge>
          )}
          {!selectedUnit && !isOver && (
            <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
              <MousePointerClick className="h-3 w-3" /> Drag AC unit here
            </Badge>
          )}
          {selectedUnit && (
            <Badge variant="outline" className="text-[10px] gap-1 border-green-300 text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" />
              Unit selected
            </Badge>
          )}
          {totalExtras > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent transition-colors"
              onClick={() => setExpanded((e) => !e)}
            >
              <Wrench className="h-3 w-3" />
              {totalExtras} item{totalExtras !== 1 ? "s" : ""}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {/* Currently selected unit */}
      {selectedUnit && (() => {
        const p = selectedUnit.product;
        const cost = p.cost_price || p.cost_excl_vat || (p.cost_incl_vat ? stripVat(p.cost_incl_vat) : 0);
        const mkup = (p as any).default_markup_percent ?? 35;
        const pricing = getProductPricing(cost, mkup);
        return (
        <div className="flex items-center gap-2.5 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2.5 text-xs">
          <ProductThumb product={p} />
          <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <PinnedStar pinned={!!(p as any).is_pinned} />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{p.product_code}</div>
            <div className="text-muted-foreground flex gap-1 flex-wrap">
              <span className="truncate">{p.short_name || p.product_code}</span>
              <span>·</span>
              <span>{selectedUnit.btu.toLocaleString()} BTU</span>
              {p.pipe_size && (<><span>·</span><span>{p.pipe_size}</span></>)}
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                Bracket: {getBracketSize(selectedUnit.btu)}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0 gap-0.5">
            <span className="text-xs font-bold">
              R{pricing.sellingPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] text-muted-foreground">
              R{pricing.sellingPriceInclVat.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} incl
            </span>
            <Badge variant="secondary" className="text-[9px] px-1 py-0 gap-0.5">
              <TrendingUp className="h-2.5 w-2.5" />
              {mkup}% M/Up
            </Badge>
          </div>
          <ProductInfoDialog product={p} />
          <button
            className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-destructive/20 shrink-0 min-h-[24px] min-w-[24px]"
            onClick={() => onRemove(area.id, 0)}
          >
            <X className="h-3.5 w-3.5 text-destructive" />
          </button>
        </div>
        );
      })()}

      {/* Consumables & Materials (expanded section) */}
      {expanded && totalExtras > 0 && (
        <div className="space-y-1 rounded-lg border border-border/50 bg-white p-2">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Materials & Consumables
          </div>
          {(area.materials || []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded border border-border/40 bg-background/60 px-2 py-1.5 text-xs">
              <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{getProductDisplayName(m.product) || m.product.product_code}</div>
                <div className="text-[10px] text-muted-foreground">
                  {m.pricingMode === "length" ? `${m.adjustedLength}m @ R${m.costPerMeter.toFixed(2)}/m` : `×${m.unitQuantity} @ ${formatUnitPrice(unitPriceOf(m.product), resolvePricingUnit(m.product))}`}
                </div>
              </div>
              <span className="text-[10px] font-medium shrink-0">
                {formatZAR(m.pricingMode === "length" ? m.totalCost : lineTotalOf(m.product, m.unitQuantity))}

              </span>
              <button
                className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-destructive/20 shrink-0"
                onClick={() => onRemoveMaterial(area.id, m.id)}
              >
                <X className="h-3 w-3 text-destructive" />
              </button>
            </div>
          ))}
          {(area.consumables || []).map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded border border-border/40 bg-background/60 px-2 py-1.5 text-xs">
              <Package className="h-3 w-3 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{getProductDisplayName(c.product) || c.product.product_code}</div>
                <div className="text-[10px] text-muted-foreground">
                  ×{c.quantity} @ {formatUnitPrice(unitPriceOf(c.product), resolvePricingUnit(c.product))} {c.isSuggested && <span className="text-primary">(auto)</span>}
                </div>
              </div>
              <span className="text-[10px] font-medium shrink-0">
                {formatZAR(lineTotalOf(c.product, c.quantity))}

              </span>
              <button
                className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-destructive/20 shrink-0"
                onClick={() => onRemoveConsumable(area.id, c.id)}
              >
                <X className="h-3 w-3 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Suggested bundle with interactive controls */}
      {selectedUnit && suggestedBundle && (
        <SuggestedBundlePanel
          bundle={suggestedBundle}
          area={area}
          onApplyBundle={onApplyBundle}
          onDismissBundle={onDismissBundle}
        />
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search AC units for this area..."
          value={query}
          onChange={(e) => {
            handleQueryChange(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
          className="pl-7 h-9 text-xs"
        />
      </div>

      {/* Dropdown results */}
      {dropdownOpen && (
        <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-lg border p-1 shadow-sm">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No AC products found</p>
          ) : (
            filtered.map((p) => {
              const btu = detectBTU(p);
              const isSelected = selectedUnit?.product.id === p.id;
              const thumbUrl = (p as any).image_url;
              return (
                <div
                  key={p.id}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent transition-colors text-left min-h-[40px] ${isSelected ? "bg-accent ring-1 ring-primary" : ""}`}
                >
                  {thumbUrl && (
                    <img src={thumbUrl} alt="" className="h-8 w-8 rounded object-cover border border-border shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
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
                    {(() => {
                      const cost = p.cost_price || p.cost_excl_vat || (p.cost_incl_vat ? stripVat(p.cost_incl_vat) : 0);
                      const mk = (p as any).default_markup_percent ?? 35;
                      const pr = getProductPricing(cost, mk);
                      return (
                        <div className="flex flex-col items-end shrink-0">
                          <span className="font-medium">R{pr.sellingPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="text-[9px] text-muted-foreground">{mk}% M/Up</span>
                        </div>
                      );
                    })()}
                  </button>
                  <ProductInfoDialog product={p} />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Step Component ─── */
export default function ACSelectionStep({ areas, onAreasChange, products, bundles = [], onPdfSearch }: Props) {
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

  // Compute suggested bundle per area
  const areaBundleSuggestions = useMemo(() => {
    const map: Record<string, PaletteBundle | null> = {};
    for (const area of areas) {
      const unit = area.acUnits[0];
      if (unit) {
        map[area.id] = findSuggestedBundle(unit.btu, unit.product.brand || "", bundles);
      } else {
        map[area.id] = null;
      }
    }
    return map;
  }, [areas, bundles]);

  const handleSelect = useCallback((areaId: string, product: PaletteProduct) => {
    const btu = detectBTU(product);
    const newUnit: AreaACUnit = { id: crypto.randomUUID(), product, btu, quantity: 1 };

    // Build suggested consumables from product's suggested_consumables JSON
    const suggestedConsumables: AreaConsumable[] = [];
    const rawSuggested = (product as any).suggested_consumables;
    if (Array.isArray(rawSuggested)) {
      for (const sc of rawSuggested) {
        if (!sc.is_default) continue;
        const consProduct = products.find((p) => p.id === sc.product_id);
        if (consProduct) {
          suggestedConsumables.push({
            id: crypto.randomUUID(),
            product: consProduct,
            quantity: sc.qty || 1,
            isSuggested: true,
          });
        }
      }
    }

    // Also auto-suggest Daikin wired remote (legacy behavior)
    const brand = (product.brand || "").toLowerCase();
    if (brand === "daikin") {
      const remote = findDaikinRemote(btu, products);
      if (remote && !suggestedConsumables.some((c) => c.product.id === remote.id)) {
        const safeRemote = forcePerUnitPricing(remote);
        suggestedConsumables.push({ id: crypto.randomUUID(), product: safeRemote, quantity: 1, isSuggested: true });
      }
    }

    if (suggestedConsumables.length > 0) {
      const names = suggestedConsumables.map((c) => c.product.short_name || c.product.product_code).join(", ");
      toast.success(`Auto-added: ${names}`);
    }

    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        // Remove existing suggested consumables and wired remotes before adding new ones
        const existingConsumables = (a.consumables || []).filter(
          (c) => !c.isSuggested && !isWiredRemote(c.product)
        );
        return { ...a, acUnits: [newUnit], consumables: [...existingConsumables, ...suggestedConsumables] };
      })
    );
  }, [areas, onAreasChange, products]);

  const handleRemove = useCallback((areaId: string, idx: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, acUnits: a.acUnits.filter((_, i) => i !== idx) };
      })
    );
  }, [areas, onAreasChange]);

  const handleRemoveConsumable = useCallback((areaId: string, consumableId: string) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, consumables: a.consumables.filter((c) => c.id !== consumableId) };
      })
    );
  }, [areas, onAreasChange]);

  const handleRemoveMaterial = useCallback((areaId: string, materialId: string) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, materials: a.materials.filter((m) => m.id !== materialId) };
      })
    );
  }, [areas, onAreasChange]);

  const handleApplyBundle = useCallback((areaId: string, bundle: PaletteBundle, overrides: Record<string, { qty: number; mode: "unit" | "length" }>) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;

        // Idempotent: drop every line previously generated by any bundle before re-adding
        const cleanMaterials = (a.materials || []).filter((m) => !m.fromBundle);
        const cleanConsumables = (a.consumables || []).filter((c) => !c.fromBundle);

        const newMaterials: AreaMaterial[] = [];
        const newConsumables: AreaConsumable[] = [];
        const seen = new Set<string>();

        for (const item of bundle.items) {
          if (item.is_optional) continue;
          const product = item.product || item.supplier_product;
          if (!product) continue;

          // Guard against the same product appearing twice in one bundle definition
          const dedupeKey = String(product.id || product.product_code || item.id);
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const override = overrides[item.id] || { qty: item.quantity || 1, mode: item.is_length_item ? "length" : "unit" };
          // Stable id derived from bundle + item so re-applying replaces instead of duplicating
          const lineId = `bundle-${bundle.id}-${item.id}`;

          if (override.mode === "length") {
            const unit = resolvePricingUnit(product);
            const unitPrice = product.price_per_metre || unitPriceOf(product);
            const per = unit.price_per_unit_qty > 0 ? unit.price_per_unit_qty : 1;
            newMaterials.push({
              id: lineId,
              product,
              defaultLength: override.qty,
              adjustedLength: override.qty,
              costPerMeter: unitPrice / per,
              totalCost: computeLineTotal(override.qty, unitPrice, unit),
              pricingMode: "length",
              unitQuantity: 1,
              fromBundle: true,
              bundleId: bundle.id,
            });
          } else {
            newConsumables.push({
              id: lineId,
              product,
              quantity: override.qty,
              isSuggested: false,
              fromBundle: true,
              bundleId: bundle.id,
            });
          }
        }


        toast.success(`Applied "${bundle.name}" to ${a.name}`);
        return {
          ...a,
          appliedBundleId: bundle.id,
          materials: [...cleanMaterials, ...newMaterials],
          consumables: [...cleanConsumables, ...newConsumables],
        };
      })
    );
  }, [areas, onAreasChange]);

  const handleDismissBundle = useCallback((areaId: string) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          appliedBundleId: undefined,
          materials: (a.materials || []).filter((m) => !(m as any).fromBundle),
          consumables: (a.consumables || []).filter((c) => !(c as any).fromBundle),
        };
      })
    );
    toast.info("Install kit removed");
  }, [areas, onAreasChange]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select an AC unit for each area. Each area has its own search bar — selections are independent.
        <span className="block text-xs mt-1 text-muted-foreground/70">
          <Zap className="inline h-3 w-3 mr-0.5" />
          Daikin units auto-suggest the correct wired remote (BRC073 / BRCW901A08).
        </span>
      </p>

      <div className="space-y-3">
        {areas.map((area) => (
          <AreaUnitSelector
            key={area.id}
            area={area}
            acProducts={acProducts}
            onSelect={handleSelect}
            onRemove={handleRemove}
            onRemoveConsumable={handleRemoveConsumable}
            onRemoveMaterial={handleRemoveMaterial}
            suggestedBundle={areaBundleSuggestions[area.id]}
            onApplyBundle={handleApplyBundle}
            onDismissBundle={handleDismissBundle}
          />
        ))}
      </div>
    </div>
  );
}
