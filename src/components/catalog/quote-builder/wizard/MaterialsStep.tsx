import { useState, useEffect, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Trash2, Star, Search, Package, X } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteProduct } from "../../QuoteBuilderTab";
import type { QuoteArea, AreaMaterial, AreaBracket, AreaConsumable } from "../quoteWizardTypes";
import { getBracketSize } from "../quoteWizardTypes";

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

const MATERIAL_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "piping", label: "Piping" },
  { key: "electrical", label: "Electrical" },
  { key: "brackets", label: "Brackets" },
  { key: "consumables", label: "Consumables" },
];

/* ── Helper: find best bundle for an area's AC units ── */
function findBestBundle(area: QuoteArea, bundles: Bundle[]): Bundle | null {
  if (area.acUnits.length === 0 || bundles.length === 0) return null;
  const maxBtu = Math.max(...area.acUnits.map((u) => u.btu));
  const brands = [...new Set(area.acUnits.map((u) => u.product.brand?.toLowerCase()).filter(Boolean))];

  // Score bundles
  let best: Bundle | null = null;
  let bestScore = -1;
  for (const b of bundles) {
    let score = 0;
    if (b.min_btu != null && b.max_btu != null) {
      if (maxBtu >= b.min_btu && maxBtu <= b.max_btu) score += 10;
      else continue; // BTU out of range, skip
    }
    if (b.compatible_brands && b.compatible_brands.length > 0) {
      const compat = b.compatible_brands.map((s) => s.toLowerCase());
      if (brands.some((br) => compat.includes(br!))) score += 5;
      else continue; // Brand mismatch, skip
    }
    if (b.is_favorite) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  // Fallback: first piping bundle or first bundle
  if (!best) {
    best = bundles.find((b) =>
      b.bundle_type === "piping" || b.name.toLowerCase().includes("piping") || b.name.toLowerCase().includes("material")
    ) || bundles[0];
  }
  return best;
}

/* ── Material favorite star ── */
function MaterialStar({ product }: { product: PaletteProduct }) {
  const queryClient = useQueryClient();
  const isFav = !!(product as any).is_material_favorite;

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ is_material_favorite: !isFav } as any)
        .eq("id", product.id);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["quote-builder-products"] });
      queryClient.setQueryData<PaletteProduct[]>(["quote-builder-products"], (old) =>
        old?.map((p) => p.id === product.id ? { ...p, is_material_favorite: !isFav } : p)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
    },
  });

  return (
    <button
      className="shrink-0 p-0.5"
      onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
      title={isFav ? "Remove from material favorites" : "Add to material favorites"}
    >
      <Star className={`h-3.5 w-3.5 ${isFav ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground/40"}`} />
    </button>
  );
}

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

  const filtered = useMemo(() => {
    let result = products;

    // Category filter
    if (category !== "all") {
      result = result.filter((p) => {
        const cat = (p.product_category || p.category || "").toLowerCase();
        const name = (p.short_name || "").toLowerCase();
        const desc = (p.description || "").toLowerCase();
        const blob = cat + " " + name + " " + desc;
        switch (category) {
          case "piping": return blob.includes("pip") || blob.includes("copper") || blob.includes("tube");
          case "electrical": return blob.includes("electr") || blob.includes("cable") || blob.includes("wire");
          case "brackets": return blob.includes("bracket") || blob.includes("mount");
          case "consumables": return blob.includes("consum") || blob.includes("tape") || blob.includes("gas") || blob.includes("drain") || blob.includes("tie");
          default: return true;
        }
      });
    }

    // Default: for consumables section, pre-filter to consumable-type products
    if (section === "consumables" && category === "all") {
      result = result.filter((p) => {
        const cat = (p.product_category || p.category || "").toLowerCase();
        return cat.includes("consum") || cat.includes("electr") || cat.includes("accessori") || cat.includes("sundri");
      });
    }

    // Search
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/);
      result = result.filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
        return terms.every((t) => blob.includes(t));
      });
    }

    // Sort: material favorites first
    result = [...result].sort((a, b) => {
      const af = (a as any).is_material_favorite ? 1 : 0;
      const bf = (b as any).is_material_favorite ? 1 : 0;
      return bf - af;
    });

    return result.slice(0, 40);
  }, [products, search, category, section]);

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
            <button
              key={p.id}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
              onClick={() => onSelect(p)}
            >
              <MaterialStar product={p} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.short_name || p.product_code}</div>
                <div className="text-muted-foreground truncate">
                  {p.product_code}
                  {p.sold_in_length && p.price_per_metre ? ` · R${p.price_per_metre.toFixed(2)}/m` : ` · R${(p.selling_price || p.cost_incl_vat || 0).toFixed(2)}`}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
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

/* ── Main Component ── */
export default function MaterialsStep({ areas, onAreasChange, bundles, products }: Props) {
  const [materialPickerOpen, setMaterialPickerOpen] = useState<Record<string, boolean>>({});
  const [consumablePickerOpen, setConsumablePickerOpen] = useState<Record<string, boolean>>({});
  const [bundlePickerOpen, setBundlePickerOpen] = useState<Record<string, boolean>>({});

  // Auto-populate materials from best-matching bundle on mount if empty
  useEffect(() => {
    const needsPopulation = areas.some((a) => a.acUnits.length > 0 && a.materials.length === 0 && a.brackets.length === 0);
    if (!needsPopulation) return;

    onAreasChange(
      areas.map((area) => {
        if (area.acUnits.length === 0 || area.materials.length > 0) return area;

        const bestBundle = findBestBundle(area, bundles);
        const materials: AreaMaterial[] = [];
        if (bestBundle) {
          for (const item of bestBundle.items) {
            if (!item.product || item.is_optional) continue;
            if (item.is_length_item && item.product.price_per_metre) {
              materials.push({
                id: crypto.randomUUID(),
                product: item.product,
                defaultLength: item.length_metres || item.product.unit_length || 3,
                adjustedLength: item.length_metres || item.product.unit_length || 3,
                costPerMeter: item.product.price_per_metre,
                totalCost: (item.length_metres || item.product.unit_length || 3) * item.product.price_per_metre,
              });
            }
          }
        }

        // Generate brackets from AC units
        const brackets: AreaBracket[] = [];
        for (const unit of area.acUnits) {
          const size = getBracketSize(unit.btu);
          const existing = brackets.find((b) => b.size === size);
          if (existing) {
            existing.quantity += unit.quantity;
          } else {
            brackets.push({
              id: crypto.randomUUID(),
              size,
              quantity: unit.quantity,
              price: BRACKET_PRICES[size] || 350,
            });
          }
        }

        return { ...area, materials, brackets };
      })
    );
  }, [areas, bundles, onAreasChange]);

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

  const addMaterialFromPicker = useCallback((areaId: string, product: PaletteProduct) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        if (product.sold_in_length && product.price_per_metre) {
          return {
            ...a,
            materials: [...a.materials, {
              id: crypto.randomUUID(),
              product,
              defaultLength: product.unit_length || 3,
              adjustedLength: product.unit_length || 3,
              costPerMeter: product.price_per_metre,
              totalCost: (product.unit_length || 3) * product.price_per_metre,
            }],
          };
        }
        // Non-length item: add as consumable
        return {
          ...a,
          consumables: [...a.consumables, { id: crypto.randomUUID(), product, quantity: 1 }],
        };
      })
    );
    setMaterialPickerOpen((prev) => ({ ...prev, [areaId]: false }));
  }, [areas, onAreasChange]);

  const addConsumableFromPicker = useCallback((areaId: string, product: PaletteProduct) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, consumables: [...a.consumables, { id: crypto.randomUUID(), product, quantity: 1 }] };
      })
    );
    setConsumablePickerOpen((prev) => ({ ...prev, [areaId]: false }));
  }, [areas, onAreasChange]);

  const updateConsumableQty = useCallback((areaId: string, consId: string, delta: number) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        return { ...a, consumables: a.consumables.map((c) => c.id === consId ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c) };
      })
    );
  }, [areas, onAreasChange]);

  const removeConsumable = useCallback((areaId: string, consId: string) => {
    onAreasChange(areas.map((a) => a.id !== areaId ? a : { ...a, consumables: a.consumables.filter((c) => c.id !== consId) }));
  }, [areas, onAreasChange]);

  const swapBundle = useCallback((areaId: string, bundle: Bundle) => {
    onAreasChange(
      areas.map((a) => {
        if (a.id !== areaId) return a;
        const materials: AreaMaterial[] = [];
        for (const item of bundle.items) {
          if (!item.product || item.is_optional) continue;
          if (item.is_length_item && item.product.price_per_metre) {
            materials.push({
              id: crypto.randomUUID(),
              product: item.product,
              defaultLength: item.length_metres || item.product.unit_length || 3,
              adjustedLength: item.length_metres || item.product.unit_length || 3,
              costPerMeter: item.product.price_per_metre,
              totalCost: (item.length_metres || item.product.unit_length || 3) * item.product.price_per_metre,
            });
          }
        }
        // Re-generate brackets
        const brackets: AreaBracket[] = [];
        for (const unit of a.acUnits) {
          const size = getBracketSize(unit.btu);
          const existing = brackets.find((b) => b.size === size);
          if (existing) existing.quantity += unit.quantity;
          else brackets.push({ id: crypto.randomUUID(), size, quantity: unit.quantity, price: BRACKET_PRICES[size] || 350 });
        }
        return { ...a, materials, brackets };
      })
    );
    setBundlePickerOpen((prev) => ({ ...prev, [areaId]: false }));
  }, [areas, onAreasChange]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Materials are auto-populated from installation bundles. Add extras, adjust lengths, and manage consumables per area.
      </p>

      <Accordion type="multiple" defaultValue={areas.map((a) => a.id)} className="space-y-2">
        {areas.map((area) => {
          const matTotal = area.materials.reduce((s, m) => s + m.totalCost, 0);
          const bracketTotal = area.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
          const consTotal = area.consumables.reduce((s, c) => s + (c.product.selling_price || c.product.cost_incl_vat || 0) * c.quantity, 0);
          const sectionTotal = matTotal + bracketTotal + consTotal;

          return (
            <AccordionItem key={area.id} value={area.id} className="border rounded-lg bg-card">
              <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  {area.name}
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
                          onClick={() => setBundlePickerOpen((prev) => ({ ...prev, [area.id]: !prev[area.id] }))}
                        >
                          <Package className="h-3 w-3 mr-1" /> Change Bundle
                        </Button>
                      </div>

                      {bundlePickerOpen[area.id] && (
                        <BundlePicker
                          bundles={bundles}
                          onSelect={(b) => swapBundle(area.id, b)}
                          onClose={() => setBundlePickerOpen((prev) => ({ ...prev, [area.id]: false }))}
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
                            <Input
                              type="number"
                              min={0.5}
                              max={50}
                              step={0.5}
                              value={mat.adjustedLength}
                              onChange={(e) => updateMaterialLength(area.id, mat.id, parseFloat(e.target.value) || 0.5)}
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
                          <Label className="text-xs font-medium">Brackets (auto-selected by BTU)</Label>
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
                          No installation bundles found. Add materials manually below.
                        </p>
                      )}

                      {/* Add Material button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-primary"
                        onClick={() => setMaterialPickerOpen((prev) => ({ ...prev, [area.id]: !prev[area.id] }))}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Material
                      </Button>

                      {materialPickerOpen[area.id] && (
                        <MaterialPicker
                          products={products}
                          onSelect={(p) => addMaterialFromPicker(area.id, p)}
                          section="materials"
                        />
                      )}
                    </div>

                    {/* ── Extras & Consumables Section ── */}
                    <div className="space-y-3 border-t pt-3">
                      <Label className="text-xs font-medium">Extras & Consumables</Label>

                      {area.consumables.length > 0 ? (
                        <div className="space-y-1.5">
                          {area.consumables.map((cons) => (
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
                        onClick={() => setConsumablePickerOpen((prev) => ({ ...prev, [area.id]: !prev[area.id] }))}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Consumable
                      </Button>

                      {consumablePickerOpen[area.id] && (
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
