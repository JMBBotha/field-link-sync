import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Trash2, Star, Search, Package, X, RefreshCw } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaMaterial, AreaBracket, AreaConsumable } from "../quoteWizardTypes";
import { getBracketSize } from "../quoteWizardTypes";
import { termMatchesBlob } from "../../searchSynonyms";

/* ── Helper: check if a product is an AC unit (should be excluded from materials) ── */
function isACUnit(p: PaletteProduct): boolean {
  const cat = (p.product_category || p.category || "").toLowerCase();
  const name = (p.short_name || "").toLowerCase();
  // Exclude if category is air conditioning
  if (cat.includes("air con") || cat.includes("ac unit") || cat.includes("split")) return true;
  // Exclude if name matches AC unit pattern (BTU + unit type abbreviation)
  if (/\d+\s*btu/i.test(name) && /\b(inv|mw|fw|fs|cass)\b/i.test(name)) return true;
  // Exclude if supplier_type is ac-only
  const st = (p as any).supplier_type || "both";
  if (st === "ac_units" || st === "ac_equipment") return true;
  return false;
}

/* ── Bundle types ── */
interface BundleItem {
  id: string;
  supplier_product_id: string;
  quantity: number;
  length_metres: number | null;
  is_length_item: boolean;
  is_optional: boolean;
  product: PaletteProduct | null;
}

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  min_btu?: number | null;
  max_btu?: number | null;
  compatible_brands?: string[] | null;
  is_favorite?: boolean;
  items: BundleItem[];
}

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
  bundles: Bundle[];
  products: PaletteProduct[];
}

const BRACKET_PRICES: Record<string, number> = {
  "450mm": 350,
  "650mm": 450,
  "L-shape": 650,
};

const BRACKET_SIZES = Object.keys(BRACKET_PRICES);

const MATERIAL_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "piping", label: "Piping" },
  { key: "electrical", label: "Electrical" },
  { key: "consumables", label: "Consumables" },
];

/* ── Helper: find best bundle for an area's AC units ── */
function findBestBundle(area: QuoteArea, bundles: Bundle[]): Bundle | null {
  if (area.acUnits.length === 0 || bundles.length === 0) return null;
  const maxBtu = Math.max(...area.acUnits.map((u) => u.btu));
  const brands = [...new Set(area.acUnits.map((u) => u.product.brand?.toLowerCase()).filter(Boolean))];

  let best: Bundle | null = null;
  let bestScore = -1;
  for (const b of bundles) {
    let score = 0;
    if (b.min_btu != null && b.max_btu != null) {
      if (maxBtu >= b.min_btu && maxBtu <= b.max_btu) score += 10;
      else continue;
    }
    if (b.compatible_brands && b.compatible_brands.length > 0) {
      const compat = b.compatible_brands.map((s) => s.toLowerCase());
      if (brands.some((br) => compat.includes(br!))) score += 5;
      else continue;
    }
    if (b.is_favorite) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  // Fix 1d: No silent fallback to bundles[0]
  return best;
}

/* ── Helper: generate brackets from AC units ── */
function generateBrackets(acUnits: QuoteArea["acUnits"]): AreaBracket[] {
  const brackets: AreaBracket[] = [];
  for (const unit of acUnits) {
    const size = getBracketSize(unit.btu);
    const existing = brackets.find((b) => b.size === size);
    if (existing) {
      existing.quantity += unit.quantity;
    } else {
      brackets.push({
        id: crypto.randomUUID(),
        size,
        quantity: unit.quantity,
        price: BRACKET_PRICES[size as keyof typeof BRACKET_PRICES] ?? 350,
      });
    }
  }
  return brackets;
}

/* ── Helper: build materials from bundle ── */
function materialsFromBundle(bundle: Bundle): AreaMaterial[] {
  const materials: AreaMaterial[] = [];
  for (const item of bundle.items) {
    if (!item.product || item.is_optional) continue;
    const ppm = item.product.price_per_metre;
    if (item.is_length_item && typeof ppm === "number" && ppm > 0) {
      const len = item.length_metres || item.product.unit_length || 3;
      materials.push({
        id: crypto.randomUUID(),
        product: item.product,
        defaultLength: len,
        adjustedLength: len,
        costPerMeter: ppm,
        totalCost: len * ppm,
      });
    }
  }
  return materials;
}

/* ── Material favorite star (memoized) ── */
const MaterialStar = memo(function MaterialStar({ product }: { product: PaletteProduct }) {
  const queryClient = useQueryClient();
  const isFav = !!product.is_material_favorite;

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ is_material_favorite: !isFav })
        .eq("id", product.id);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["quote-builder-products"] });
      queryClient.setQueryData<PaletteProduct[]>(["quote-builder-products"], (old) =>
        old?.map((p) => p.id === product.id ? { ...p, is_material_favorite: !isFav } : p)
      );
    },
    onError: (_err, _vars, _ctx) => {
      // Rollback optimistic update
      queryClient.setQueryData<PaletteProduct[]>(["quote-builder-products"], (old) =>
        old?.map((p) => p.id === product.id ? { ...p, is_material_favorite: isFav } : p)
      );
      toast({ title: "Failed to update favorite", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
    },
  });

  return (
    <button
      className="shrink-0 p-0.5"
      disabled={mutation.isPending}
      onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
      title={isFav ? "Remove from material favorites" : "Add to material favorites"}
    >
      <Star className={`h-3.5 w-3.5 ${isFav ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground/40"} ${mutation.isPending ? "opacity-50" : ""}`} />
    </button>
  );
});

/* ── Picker Row (memoized to avoid re-instantiating mutation hooks) ── */
const PickerRow = memo(function PickerRow({ product, onSelect }: { product: PaletteProduct; onSelect: () => void }) {
  return (
    <button
      className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
      onClick={onSelect}
    >
      <MaterialStar product={product} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{product.short_name || product.product_code}</div>
        <div className="text-muted-foreground truncate">
          {product.product_code}
          {product.sold_in_length && typeof product.price_per_metre === "number" && product.price_per_metre > 0
            ? ` · R${product.price_per_metre.toFixed(2)}/m`
            : ` · R${(product.selling_price || product.cost_incl_vat || 0).toFixed(2)}`}
        </div>
      </div>
    </button>
  );
});

/* ── Product Picker Drawer (inline) ── */
function MaterialPicker({
  products,
  onSelect,
  section,
}: {
  products: PaletteProduct[];
  onSelect: (p: PaletteProduct) => void;
  section: "materials" | "consumables";
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const RESULT_LIMIT = 40;

  const filtered = useMemo(() => {
    let result = products;

    // Exclude AC units from materials/consumables picker
    result = result.filter((p) => !isACUnit(p));

    // Only show products from installation-material-compatible suppliers
    result = result.filter((p) => {
      const st = (p as any).supplier_type || "both";
      return st === "installation_material" || st === "consumables" || st === "both";
    });

    // Category filter
    if (category !== "all") {
      result = result.filter((p) => {
        const cat = (p.product_category || p.category || "").toLowerCase();
        const name = (p.short_name || "").toLowerCase();
        const desc = (p.description || "").toLowerCase();
        const blob = cat + " " + name + " " + desc;
        switch (category) {
          case "piping": return blob.includes("pip") || blob.includes("copper") || blob.includes("tube") || blob.includes("elbow") || blob.includes("coupling") || blob.includes("insulation");
          case "electrical": return blob.includes("electr") || blob.includes("cable") || blob.includes("wire") || blob.includes("capacitor");
          case "consumables": return blob.includes("consum") || blob.includes("tape") || blob.includes("gas") || blob.includes("drain") || blob.includes("tie") || blob.includes("solder") || blob.includes("adhesive") || blob.includes("cleaner");
          default: return true;
        }
      });
    } else if (!search.trim()) {
      // When no search and "all" category, show installation-relevant categories only (not AC units)
      if (section === "materials") {
        result = result.filter((p) => {
          const cat = (p.product_category || p.category || "").toLowerCase();
          return cat.includes("pip") || cat.includes("copper") || cat.includes("insulation") || cat.includes("bracket") || cat.includes("elbow") || cat.includes("coupling") || cat.includes("rod") || cat.includes("flare") || cat.includes("saddle") || cat.includes("trunking") || cat.includes("kit");
        });
      } else if (section === "consumables") {
        result = result.filter((p) => {
          const cat = (p.product_category || p.category || "").toLowerCase();
          return cat.includes("consum") || cat.includes("electr") || cat.includes("accessori") || cat.includes("sundri") || cat.includes("tape") || cat.includes("cable") || cat.includes("gas") || cat.includes("refrigerant") || cat.includes("drain") || cat.includes("solder") || cat.includes("adhesive") || cat.includes("cleaner") || cat.includes("tool");
        });
      }
    }

    // Search with synonym + pipe size alias expansion
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/);
      result = result.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
        return terms.every((t) => termMatchesBlob(t, blob));
      });
    }

    // Sort: material favorites first
    result = [...result].sort((a, b) => {
      const af = a.is_material_favorite ? 1 : 0;
      const bf = b.is_material_favorite ? 1 : 0;
      return bf - af;
    });

    return result.slice(0, RESULT_LIMIT);
  }, [products, search, category, section]);

  const totalBeforeLimit = useMemo(() => {
    let result = products.filter((p) => !isACUnit(p));
    result = result.filter((p) => {
      const st = (p as any).supplier_type || "both";
      return st === "installation_material" || st === "consumables" || st === "both";
    });
    // No strict section filter — matches the filtered logic above
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/);
      result = result.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
        return terms.every((t) => termMatchesBlob(t, blob));
      });
    }
    return result.length;
  }, [products, search, section]);

  return (
    <div className="space-y-2 rounded border bg-muted/20 p-2">
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-7 h-8 text-xs"
        />
      </div>
      <div className="flex gap-1 flex-wrap">
        {MATERIAL_CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${category === c.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">No products found</p>
        ) : (
          filtered.map((p) => (
            <PickerRow key={p.id} product={p} onSelect={() => onSelect(p)} />
          ))
        )}
      </div>
      {/* Fix 5f: Truncation hint */}
      {totalBeforeLimit > RESULT_LIMIT && (
        <p className="text-[10px] text-muted-foreground text-center">
          Showing {RESULT_LIMIT} of {totalBeforeLimit} results — refine your search to see more.
        </p>
      )}
    </div>
  );
}

/* ── Bundle Picker ── */
function BundlePicker({
  bundles,
  onSelect,
  onClose,
}: {
  bundles: Bundle[];
  onSelect: (b: Bundle) => void;
  onClose: () => void;
}) {
  const sorted = useMemo(() => [...bundles].sort((a, b) => {
    const af = a.is_favorite ? 1 : 0;
    const bf = b.is_favorite ? 1 : 0;
    if (bf !== af) return bf - af;
    return a.name.localeCompare(b.name);
  }), [bundles]);

  return (
    <div className="space-y-2 rounded border bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Select Bundle</Label>
        <button onClick={onClose} className="h-5 w-5 rounded flex items-center justify-center hover:bg-accent">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {sorted.map((b) => (
          <button
            key={b.id}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
            onClick={() => onSelect(b)}
          >
            {b.is_favorite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-500 shrink-0" />}
            <Package className="h-3 w-3 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{b.name}</div>
              {b.description && <div className="text-muted-foreground truncate">{b.description}</div>}
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">{b.items.length} items</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Add Bracket Picker ── */
function AddBracketPicker({ onAdd }: { onAdd: (size: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {BRACKET_SIZES.map((size) => (
        <Button key={size} variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => onAdd(size)}>
          <Plus className="h-3 w-3 mr-0.5" /> {size} (R{BRACKET_PRICES[size]})
        </Button>
      ))}
    </div>
  );
}

/* ── Main Component ── */
export default function MaterialsStep({ areas, onAreasChange, bundles, products }: Props) {
  // Fix 4c: Combine picker states into one
  const [openPicker, setOpenPicker] = useState<Record<string, "material" | "consumable" | "bundle" | "add-bracket" | null>>({});

  // Fix 5a: Controlled accordion state with auto-expand for new areas
  const [expandedAreas, setExpandedAreas] = useState<string[]>(areas.map((a) => a.id));
  const knownAreaIds = useRef<Set<string>>(new Set(areas.map((a) => a.id)));

  useEffect(() => {
    const newIds = areas.filter((a) => !knownAreaIds.current.has(a.id)).map((a) => a.id);
    if (newIds.length > 0) {
      newIds.forEach((id) => knownAreaIds.current.add(id));
      setExpandedAreas((prev) => [...prev, ...newIds]);
    }
  }, [areas]);

  // Fix 1a: useRef to track populated areas, no onAreasChange in deps
  const populatedMaterialIds = useRef<Set<string>>(new Set());
  const populatedBracketIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Fix 1b: Separate bracket and material population
    const needsMaterials = areas.filter(
      (a) => a.acUnits.length > 0 && a.materials.length === 0 && !populatedMaterialIds.current.has(a.id)
    );
    const needsBrackets = areas.filter(
      (a) => a.acUnits.length > 0 && a.brackets.length === 0 && !populatedBracketIds.current.has(a.id)
    );

    if (needsMaterials.length === 0 && needsBrackets.length === 0) return;

    needsMaterials.forEach((a) => populatedMaterialIds.current.add(a.id));
    needsBrackets.forEach((a) => populatedBracketIds.current.add(a.id));

    const matIds = new Set(needsMaterials.map((a) => a.id));
    const brIds = new Set(needsBrackets.map((a) => a.id));

    onAreasChange(
      areas.map((area) => {
        let updated = area;
        if (matIds.has(area.id)) {
          const bestBundle = findBestBundle(area, bundles);
          const materials = bestBundle ? materialsFromBundle(bestBundle) : [];
          updated = { ...updated, materials, appliedBundleId: bestBundle?.id ?? undefined };
        }
        if (brIds.has(area.id)) {
          updated = { ...updated, brackets: generateBrackets(area.acUnits) };
        }
        return updated;
      })
    );
  }, [areas, bundles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 4a: Remove `areas` from useCallback deps, use functional state updates via onAreasChange
  const updateMaterialLength = useCallback((areaId: string, matId: string, length: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          materials: a.materials.map((m) =>
            m.id === matId ? { ...m, adjustedLength: length, totalCost: length * m.costPerMeter } : m
          ),
        };
      })
    );
  }, [areas, onAreasChange]);

  const removeMaterial = useCallback((areaId: string, matId: string) => {
    onAreasChange(areas.map((a) => a.id !== areaId ? a : { ...a, materials: a.materials.filter((m) => m.id !== matId) }));
  }, [areas, onAreasChange]);

  const updateBracketQty = useCallback((areaId: string, bracketId: string, delta: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, brackets: a.brackets.map((b) => b.id === bracketId ? { ...b, quantity: Math.max(1, b.quantity + delta) } : b) };
      })
    );
  }, [areas, onAreasChange]);

  const removeBracket = useCallback((areaId: string, bracketId: string) => {
    onAreasChange(areas.map((a) => a.id !== areaId ? a : { ...a, brackets: a.brackets.filter((b) => b.id !== bracketId) }));
  }, [areas, onAreasChange]);

  const addBracket = useCallback((areaId: string, size: string) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          brackets: [...a.brackets, {
            id: crypto.randomUUID(),
            size,
            quantity: 1,
            price: BRACKET_PRICES[size as keyof typeof BRACKET_PRICES] ?? 350,
          }],
        };
      })
    );
    setOpenPicker((prev) => ({ ...prev, [areaId]: null }));
  }, [areas, onAreasChange]);

  const addMaterialFromPicker = useCallback((areaId: string, product: PaletteProduct) => {
    // Fix 1e: materials picker only adds length items (filtering is done in picker)
    const ppm = product.price_per_metre;
    if (product.sold_in_length && typeof ppm === "number" && ppm > 0) {
      const len = product.unit_length || 3;
      onAreasChange(
        areas.map((a) => {
          if (a.id !== areaId) return a;
          return {
            ...a,
            materials: [...a.materials, {
              id: crypto.randomUUID(),
              product,
              defaultLength: len,
              adjustedLength: len,
              costPerMeter: ppm,
              totalCost: len * ppm,
            }],
          };
        })
      );
    }
    setOpenPicker((prev) => ({ ...prev, [areaId]: null }));
  }, [areas, onAreasChange]);

  const addConsumableFromPicker = useCallback((areaId: string, product: PaletteProduct) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, consumables: [...(a.consumables ?? []), { id: crypto.randomUUID(), product, quantity: 1 }] };
      })
    );
    setOpenPicker((prev) => ({ ...prev, [areaId]: null }));
  }, [areas, onAreasChange]);

  const updateConsumableQty = useCallback((areaId: string, consId: string, delta: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, consumables: (a.consumables ?? []).map((c) => c.id === consId ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c) };
      })
    );
  }, [areas, onAreasChange]);

  const removeConsumable = useCallback((areaId: string, consId: string) => {
    onAreasChange(areas.map((a) => a.id !== areaId ? a : { ...a, consumables: (a.consumables ?? []).filter((c) => c.id !== consId) }));
  }, [areas, onAreasChange]);

  // Fix 1c: Preserve consumables when swapping bundle
  const swapBundle = useCallback((areaId: string, bundle: Bundle) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        const materials = materialsFromBundle(bundle);
        const brackets = generateBrackets(a.acUnits);
        return { ...a, materials, brackets, consumables: a.consumables ?? [], appliedBundleId: bundle.id };
      })
    );
    setOpenPicker((prev) => ({ ...prev, [areaId]: null }));
  }, [areas, onAreasChange]);

  // Fix 5d: Regenerate brackets from current AC units
  const regenerateBrackets = useCallback((areaId: string) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, brackets: generateBrackets(a.acUnits) };
      })
    );
  }, [areas, onAreasChange]);

  // Find applied bundle name for display
  const bundleNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bundles) map[b.id] = b.name;
    return map;
  }, [bundles]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Materials are auto-populated from installation bundles. Add extras, adjust lengths, and manage consumables per area.
      </p>

      {/* Fix 5a: Controlled accordion */}
      <Accordion type="multiple" value={expandedAreas} onValueChange={setExpandedAreas} className="space-y-2">
        {areas.map((area) => {
          const matTotal = area.materials.reduce((s, m) => s + m.totalCost, 0);
          const bracketTotal = area.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
          // Fix 2d: Defensive consumables access
          const consTotal = (area.consumables ?? []).reduce((s, c) => s + (c.product.selling_price || c.product.cost_incl_vat || 0) * c.quantity, 0);
          const sectionTotal = matTotal + bracketTotal + consTotal;
          const pickerState = openPicker[area.id] ?? null;
          // Fix 5b: Show applied bundle name
          const appliedBundleName = area.appliedBundleId ? bundleNameMap[area.appliedBundleId] : null;

          return (
            <AccordionItem key={area.id} value={area.id} className="border rounded-lg bg-card">
              <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  {area.name}
                  {appliedBundleName && (
                    <Badge variant="outline" className="text-[10px]">{appliedBundleName}</Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    R {sectionTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-4">
                {area.acUnits.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Add AC units in Step 2 first</p>
                ) : (
                  <>
                    {/* ── Installation Materials Section ── */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Installation Materials</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => setOpenPicker((prev) => ({ ...prev, [area.id]: prev[area.id] === "bundle" ? null : "bundle" }))}
                        >
                          <Package className="h-3 w-3 mr-1" /> Change Bundle
                        </Button>
                      </div>

                      {pickerState === "bundle" && (
                        <BundlePicker
                          bundles={bundles}
                          onSelect={(b) => swapBundle(area.id, b)}
                          onClose={() => setOpenPicker((prev) => ({ ...prev, [area.id]: null }))}
                        />
                      )}

                      {/* Materials (length items) */}
                      {area.materials.map((mat) => (
                        <div key={mat.id} className="space-y-1.5 rounded border bg-muted/30 p-2">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <MaterialStar product={mat.product} />
                              <span className="font-medium truncate">{mat.product.short_name || mat.product.product_code}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-muted-foreground">R {mat.costPerMeter.toFixed(2)}/m</span>
                              <button
                                className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20"
                                onClick={() => removeMaterial(area.id, mat.id)}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {/* Fix 2b: Validate parseFloat, clamp NaN */}
                            <Input
                              type="number"
                              min={0.5}
                              max={50}
                              step={0.5}
                              value={mat.adjustedLength}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                const clamped = isNaN(parsed) ? mat.adjustedLength : Math.max(0.5, Math.min(50, parsed));
                                updateMaterialLength(area.id, mat.id, clamped);
                              }}
                              className="h-7 w-20 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">m</span>
                            <Slider
                              value={[mat.adjustedLength]}
                              onValueChange={([v]) => updateMaterialLength(area.id, mat.id, v)}
                              min={0.5}
                              max={50}
                              step={0.5}
                              className="flex-1"
                            />
                            <span className="text-xs font-medium w-20 text-right">
                              R {mat.totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      ))}

                      {/* Brackets */}
                      {area.brackets.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium">Brackets (auto-selected by BTU)</Label>
                            {/* Fix 5d: Regenerate Brackets button */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-1.5 text-muted-foreground"
                              onClick={() => regenerateBrackets(area.id)}
                              title="Re-sync brackets from AC units"
                            >
                              <RefreshCw className="h-3 w-3 mr-0.5" /> Regenerate
                            </Button>
                          </div>
                          {area.brackets.map((bracket) => (
                            <div key={bracket.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs">
                              <Badge variant="outline" className="text-[10px]">{bracket.size}</Badge>
                              <span className="flex-1">@ R {bracket.price.toFixed(2)} each</span>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateBracketQty(area.id, bracket.id, -1)}>
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-6 text-center font-medium">{bracket.quantity}</span>
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateBracketQty(area.id, bracket.id, 1)}>
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                              <span className="font-medium w-20 text-right">
                                R {(bracket.price * bracket.quantity).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20 shrink-0"
                                onClick={() => removeBracket(area.id, bracket.id)}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {area.materials.length === 0 && area.brackets.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          No installation bundles matched. Add materials manually below.
                        </p>
                      )}

                      {/* Add Material / Add Bracket buttons */}
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-primary"
                          onClick={() => setOpenPicker((prev) => ({ ...prev, [area.id]: prev[area.id] === "material" ? null : "material" }))}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add Material
                        </Button>
                        {/* Fix 5e: Add Bracket button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-primary"
                          onClick={() => setOpenPicker((prev) => ({ ...prev, [area.id]: prev[area.id] === "add-bracket" ? null : "add-bracket" }))}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add Bracket
                        </Button>
                      </div>

                      {pickerState === "material" && (
                        <MaterialPicker
                          products={products}
                          onSelect={(p) => addMaterialFromPicker(area.id, p)}
                          section="materials"
                        />
                      )}

                      {pickerState === "add-bracket" && (
                        <AddBracketPicker onAdd={(size) => addBracket(area.id, size)} />
                      )}
                    </div>

                    {/* ── Extras & Consumables Section ── */}
                    <div className="space-y-3 border-t pt-3">
                      <Label className="text-xs font-medium">Extras & Consumables</Label>

                      {(area.consumables ?? []).length > 0 ? (
                        <div className="space-y-1.5">
                          {(area.consumables ?? []).map((cons) => (
                            <div key={cons.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs">
                              <MaterialStar product={cons.product} />
                              <div className="flex-1 min-w-0">
                                <span className="font-medium truncate block">{cons.product.short_name || cons.product.product_code}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateConsumableQty(area.id, cons.id, -1)}>
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-6 text-center font-medium">{cons.quantity}</span>
                                <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateConsumableQty(area.id, cons.id, 1)}>
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                              <span className="font-medium w-20 text-right">
                                R {((cons.product.selling_price || cons.product.cost_incl_vat || 0) * cons.quantity).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                              </span>
                              <button
                                className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20 shrink-0"
                                onClick={() => removeConsumable(area.id, cons.id)}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-1">
                          No extras added yet.
                        </p>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-primary"
                        onClick={() => setOpenPicker((prev) => ({ ...prev, [area.id]: prev[area.id] === "consumable" ? null : "consumable" }))}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Consumable
                      </Button>

                      {pickerState === "consumable" && (
                        <MaterialPicker
                          products={products}
                          onSelect={(p) => addConsumableFromPicker(area.id, p)}
                          section="consumables"
                        />
                      )}
                    </div>

                    {/* Area subtotal */}
                    <div className="flex justify-end pt-2 border-t text-xs">
                      <span className="text-muted-foreground mr-2">Area materials & extras total:</span>
                      <span className="font-bold">
                        R {sectionTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
