import { useState, useMemo, useCallback } from "react";
import { Search, Check, Star, X, Zap, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ProductInfoDialog from "@/components/shared/ProductInfoDialog";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit, AreaConsumable } from "../quoteWizardTypes";
import { detectBTU, getBracketSize } from "../quoteWizardTypes";
import { findDaikinRemote, forcePerUnitPricing, isWiredRemote } from "../daikinRemoteUtils";
import { toast } from "sonner";

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
    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500 shrink-0" />
  ) : null;
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
    // Check name/description for BTU keywords
    const text = [b.name, b.description].filter(Boolean).join(" ").toLowerCase();
    const kw = Math.round(btu / 1000);
    if (text.includes(`${kw}k`) || text.includes(`${kw}kw`)) score += 3;
    if (b.is_favorite) score += 2;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/* ─── Per-area search dropdown (Bug 1: fully independent per area) ─── */
function AreaUnitSelector({
  area,
  acProducts,
  onSelect,
  onRemove,
  suggestedBundle,
}: {
  area: QuoteArea;
  acProducts: PaletteProduct[];
  onSelect: (areaId: string, product: PaletteProduct) => void;
  onRemove: (areaId: string, idx: number) => void;
  suggestedBundle?: PaletteBundle | null;
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
          <ProductInfoDialog product={selectedUnit.product} />
          <button
            className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20 shrink-0"
            onClick={() => onRemove(area.id, 0)}
          >
            <X className="h-3 w-3 text-destructive" />
          </button>
        </div>
      )}

      {/* Suggested bundle badge */}
      {selectedUnit && suggestedBundle && (
        <div className="flex items-center gap-2 rounded border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs">
          <Package className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground">Suggested install kit:</span>
          <span className="font-medium text-foreground">{suggestedBundle.name}</span>
          <Badge variant="secondary" className="text-[10px]">{suggestedBundle.items.length} items</Badge>
          <span className="text-[10px] text-muted-foreground ml-auto">Auto-applied in Step 3</span>
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
                <div
                  key={p.id}
                  className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left ${isSelected ? "bg-accent ring-1 ring-primary" : ""}`}
                >
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
                    <span className="font-medium shrink-0">
                      {formatZAR(p.selling_price || p.cost_incl_vat || 0)}
                    </span>
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
            suggestedBundle={areaBundleSuggestions[area.id]}
          />
        ))}
      </div>
    </div>
  );
}
