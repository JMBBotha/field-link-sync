/**
 * Inline (non-modal) version of the Area Quote Builder wizard.
 * Renders the same stepper + steps + footer but as a permanent panel
 * that fills its parent container.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { ChevronLeft, ChevronRight, Check, Save, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";
import { hapticTap } from "@/lib/haptics";
import type { PaletteProduct, Basket, BasketItem } from "../QuoteBuilderTab";
import type { QuoteArea, AreaACUnit, AreaConsumable, AreaMaterial } from "./quoteWizardTypes";
import { WIZARD_STEPS, computeAreaSubtotal, createEmptyArea, detectBTU } from "./quoteWizardTypes";
import AreaDefinitionStep from "./wizard/AreaDefinitionStep";
import ACSelectionStep from "./wizard/ACSelectionStep";
import PricingStep from "./wizard/PricingStep";
import { TimeAllocationStep, ReviewStep } from "./wizard/PlaceholderSteps";

interface PaletteBundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  items: any[];
}

interface Props {
  products: PaletteProduct[];
  bundles: PaletteBundle[];
  onSave: (baskets: Basket[]) => void;
  onPdfSearch?: (term: string) => void;
  onAreasChange?: (areas: QuoteArea[]) => void;
  /** Ref that parent can use to push products into the builder */
  onAddProductRef?: React.MutableRefObject<((product: PaletteProduct) => void) | null>;
  /** Ref that parent can use to drop a product into a specific area by id */
  onDropProductToAreaRef?: React.MutableRefObject<((areaId: string, product: PaletteProduct) => void) | null>;
  /** Ref that parent can use to drop a bundle into a specific area by id */
  onDropBundleToAreaRef?: React.MutableRefObject<((areaId: string, bundle: any) => void) | null>;
  /** Ref that parent can use to add a new area */
  onAddAreaRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref that parent can use to apply a template (replaces all areas) */
  onApplyTemplateRef?: React.MutableRefObject<((zoneNames: string[]) => void) | null>;
  /** Ref that parent can use to clear all areas */
  onClearAllRef?: React.MutableRefObject<(() => void) | null>;
  pdfSelection?: PdfSelectionHandlers;
  /** Seed areas from an existing quote so the wizard reflects real DB items
   *  instead of an empty "Additional Items/Services" placeholder. */
  initialAreas?: QuoteArea[] | null;
  /** Real, persisted "Generate Quote" action forwarded to the Pricing step,
   *  so the wizard's own button always saves against the actual selected
   *  client and opens the correct send-to-client PDF flow — instead of the
   *  step building its own disconnected, client-only quote/PDF. */
  onGenerateQuote?: () => void;
  generating?: boolean;
}

const DRAFT_STORAGE_KEY = "quote-builder-draft";

function saveDraftToStorage(areas: QuoteArea[], step: number) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ areas, step, savedAt: Date.now() }));
  } catch { /* ignore */ }
}

function loadDraftFromStorage(): { areas: QuoteArea[]; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.areas?.length > 0 && parsed.areas.some(hasAreaContent)) return parsed;
  } catch { /* corrupted */ }
  return null;
}

function clearDraftStorage() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
}

function hasAreaContent(area: QuoteArea): boolean {
  return (
    area.acUnits.length > 0 ||
    area.materials.length > 0 ||
    area.brackets.length > 0 ||
    area.consumables.length > 0
  );
}

export default function AreaQuoteBuilderInline({ products, bundles, onSave, onPdfSearch, onAreasChange, onAddProductRef, onDropProductToAreaRef, onDropBundleToAreaRef, onAddAreaRef, onApplyTemplateRef, onClearAllRef, pdfSelection, initialAreas, onGenerateQuote, generating }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [areas, setAreas] = useState<QuoteArea[]>(() => {
    if (initialAreas && initialAreas.length > 0) return initialAreas;
    const draft = loadDraftFromStorage();
    if (draft) return draft.areas;
    return [];
  });

  // Hydrate from parent-provided areas exactly once when they arrive
  // (i.e. after the quote finishes loading from the DB).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!initialAreas || initialAreas.length === 0) return;
    hydratedRef.current = true;
    setAreas(initialAreas);
  }, [initialAreas]);

  // Load draft step on mount
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const draft = loadDraftFromStorage();
    if (draft && !hydratedRef.current) {
      setCurrentStep(draft.step);
      toast.info("Draft restored from last session");
    }
  }, []);

  // Notify parent of area changes
  useEffect(() => {
    onAreasChange?.(areas);
  }, [areas, onAreasChange]);

  // External product add: routes product to the first area based on category
  const handleExternalProductAdd = useCallback((product: PaletteProduct) => {
    setAreas((prev) => {
      const working = prev.length > 0 ? prev : [createEmptyArea("Additional Items/Services")];
      const targetArea = working[0];
      const isAC = product.product_category === "Air Conditioning" || (product.category || "").toLowerCase().includes("air conditioning");
      
      if (isAC) {
        const btu = detectBTU(product);
        const newUnit: AreaACUnit = { id: crypto.randomUUID(), product, btu, quantity: 1 };
        return working.map((a, i) => i === 0 ? { ...a, acUnits: [newUnit] } : a);
      } else {
        const existing = targetArea.consumables.find((c) => c.product.id === product.id);
        if (existing) {
          return working.map((a, i) => i === 0 ? {
            ...a,
            consumables: a.consumables.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
          } : a);
        }
        const newConsumable: AreaConsumable = { id: crypto.randomUUID(), product, quantity: 1 };
        return working.map((a, i) => i === 0 ? { ...a, consumables: [...a.consumables, newConsumable] } : a);
      }
    });
    toast.success(`Added ${product.short_name || product.product_code} to ${areas[0]?.name || "Additional Items/Services"}`);
  }, [areas]);

  // Drop a bundle into a specific area by ID (used by DnD from palette)
  const handleDropBundleToArea = useCallback((areaId: string, bundle: any) => {
    setAreas((prev) => {
      return prev.map((a) => {
        if (a.id !== areaId) return a;

        // Idempotent: drop every previously bundle-generated line first
        const cleanMaterials = (a.materials || []).filter((m) => !m.fromBundle);
        const cleanConsumables = (a.consumables || []).filter((c) => !c.fromBundle);

        const newMaterials: AreaMaterial[] = [];
        const newConsumables: AreaConsumable[] = [];
        const seen = new Set<string>();

        for (const item of bundle.items || []) {
          if (item.is_optional) continue;
          const product = item.product || item.supplier_product;
          if (!product) continue;

          const dedupeKey = String(product.id || product.product_code || item.id);
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const lineId = `bundle-${bundle.id}-${item.id}`;

          if (item.is_length_item) {
            const unit = resolvePricingUnit(product);
            // Always re-resolve from the live catalog record — never a cached bundle_item snapshot
            const unitPrice = product.cost_price || product.cost_excl_vat || product.price_per_metre || product.selling_price || 0;
            const per = unit.price_per_unit_qty > 0 ? unit.price_per_unit_qty : 1;

            const length = item.length_metres || 3;
            newMaterials.push({
              id: lineId,
              product,
              defaultLength: length,
              adjustedLength: length,
              costPerMeter: unitPrice / per,
              totalCost: computeLineTotal(length, unitPrice, unit),
              pricingMode: "length",
              unitQuantity: 1,
              fromBundle: true,
              bundleId: bundle.id,
            });
          } else {
            newConsumables.push({
              id: lineId,
              product,
              quantity: item.quantity || 1,
              isSuggested: false,
              fromBundle: true,
              bundleId: bundle.id,
            });
          }
        }


        return {
          ...a,
          appliedBundleId: bundle.id,
          materials: [...cleanMaterials, ...newMaterials],
          consumables: [...cleanConsumables, ...newConsumables],
        };
      });
    });
    // Switch to AC Units step so user can see the dropped items
    setCurrentStep(1);
    const targetArea = areas.find((a) => a.id === areaId);
    toast.success(`Applied "${bundle.name}" to ${targetArea?.name || "area"}`);
  }, [areas]);

  // Drop a product into a specific area — also switch to AC Units step
  const handleDropProductToArea = useCallback((areaId: string, product: PaletteProduct) => {
    const isAC = product.product_category === "Air Conditioning" || (product.category || "").toLowerCase().includes("air conditioning");
    setAreas((prev) => {
      return prev.map((a) => {
        if (a.id !== areaId) return a;
        if (isAC) {
          const btu = detectBTU(product);
          const newUnit: AreaACUnit = { id: crypto.randomUUID(), product, btu, quantity: 1 };
          return { ...a, acUnits: [newUnit] };
        } else {
          const existing = a.consumables.find((c) => c.product.id === product.id);
          if (existing) {
            return { ...a, consumables: a.consumables.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c) };
          }
          const newConsumable: AreaConsumable = { id: crypto.randomUUID(), product, quantity: 1 };
          return { ...a, consumables: [...a.consumables, newConsumable] };
        }
      });
    });
    // Switch to AC Units step so user can see the dropped items
    setCurrentStep(1);
    const targetArea = areas.find((a) => a.id === areaId);
    toast.success(`Added ${product.short_name || product.product_code} to ${targetArea?.name || "area"}`);
  }, [areas]);

  // Add a new area from the header button
  const handleAddArea = useCallback(() => {
    const newName = `Room ${areas.length + 1}`;
    setAreas((prev) => [...prev, createEmptyArea(newName)]);
    setCurrentStep(0); // Go to Areas step so user can see it
    toast.success(`Added "${newName}"`);
  }, [areas.length]);

  // Apply a zone template (replaces all areas)
  const handleApplyTemplate = useCallback((zoneNames: string[]) => {
    setAreas(zoneNames.map((name) => createEmptyArea(name)));
    setCurrentStep(0);
    toast.success(`Applied template with ${zoneNames.length} areas`);
  }, []);

  // Clear all areas
  const handleClearAll = useCallback(() => {
    setAreas([]);
    setCurrentStep(0);
  }, []);

  // Expose methods to parent via refs
  useEffect(() => {
    if (onAddProductRef) onAddProductRef.current = handleExternalProductAdd;
    if (onDropProductToAreaRef) onDropProductToAreaRef.current = handleDropProductToArea;
    if (onDropBundleToAreaRef) onDropBundleToAreaRef.current = handleDropBundleToArea;
    if (onAddAreaRef) onAddAreaRef.current = handleAddArea;
    if (onApplyTemplateRef) onApplyTemplateRef.current = handleApplyTemplate;
    if (onClearAllRef) onClearAllRef.current = handleClearAll;
    return () => {
      if (onAddProductRef) onAddProductRef.current = null;
      if (onDropProductToAreaRef) onDropProductToAreaRef.current = null;
      if (onDropBundleToAreaRef) onDropBundleToAreaRef.current = null;
      if (onAddAreaRef) onAddAreaRef.current = null;
      if (onApplyTemplateRef) onApplyTemplateRef.current = null;
      if (onClearAllRef) onClearAllRef.current = null;
    };
  }, [onAddProductRef, onDropProductToAreaRef, onDropBundleToAreaRef, onAddAreaRef, onApplyTemplateRef, onClearAllRef, handleExternalProductAdd, handleDropProductToArea, handleDropBundleToArea, handleAddArea, handleApplyTemplate, handleClearAll]);

  const handleSaveDraft = useCallback(() => {
    saveDraftToStorage(areas, currentStep);
    hapticTap("medium");
    toast.success("Draft saved");
  }, [areas, currentStep]);

  const canNext = useMemo(() => {
    if (currentStep === 0) return areas.length > 0 && areas.every((a) => a.name.trim().length > 0);
    if (currentStep === 1) return areas.every((a) => a.acUnits.length > 0);
    return true;
  }, [currentStep, areas]);

  const goNext = useCallback(() => {
    if (currentStep < WIZARD_STEPS.length - 1 && canNext) {
      setCurrentStep((s) => s + 1);
      hapticTap("medium");
    }
  }, [currentStep, canNext]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      hapticTap("light");
    }
  }, [currentStep]);

  const handleSave = useCallback(() => {
    const baskets: Basket[] = [];
    for (const area of areas) {
      const allItems: BasketItem[] = [
        ...area.acUnits.map((u) => ({
          instanceId: `${u.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          product: u.product,
          quantity: u.quantity,
        })),
        ...area.materials.map((m) => ({
          instanceId: `${m.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          product: m.product,
          quantity: m.pricingMode === "unit" ? m.unitQuantity : 1,
          ...(m.pricingMode === "length" ? { length: m.adjustedLength } : {}),
        })),
        ...area.consumables.map((c) => ({
          instanceId: `${c.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          product: c.product,
          quantity: c.quantity,
        })),
      ];
      if (allItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}`, name: area.name, items: allItems });
      }
    }
    onSave(baskets);
    clearDraftStorage();
    setCurrentStep(0);
    setAreas([]);
    toast.success("Quote areas added successfully");
  }, [areas, onSave]);

  const stepContent = useMemo(() => {
    const props = { areas, onAreasChange: setAreas };
    switch (currentStep) {
      case 0: return <AreaDefinitionStep {...props} />;
      case 1: return <ACSelectionStep {...props} products={products} bundles={bundles} onPdfSearch={onPdfSearch} />;
      case 2: return <PricingStep {...props} onGenerateQuote={onGenerateQuote} generating={generating} />;
      case 3: return <TimeAllocationStep {...props} />;
      case 4: return <ReviewStep {...props} />;
      default: return null;
    }
  }, [currentStep, areas, products, bundles, onPdfSearch, onGenerateQuote, generating]);

  const grandTotal = useMemo(() => areas.reduce((s, a) => s + computeAreaSubtotal(a), 0), [areas]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-card rounded-lg overflow-hidden relative">
      {/* PDF import button */}
      {pdfSelection && pdfSelection.selectedFromPdf.length > 0 && (
        <div className="flex justify-end px-4 pt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              for (const item of pdfSelection.selectedFromPdf) {
                const match = products.find((p) => p.product_code === item.code);
                if (match) handleExternalProductAdd(match);
              }
              toast.success(`Imported ${pdfSelection.selectedFromPdf.length} selected items`);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Import {pdfSelection.selectedFromPdf.length} Selected
          </Button>
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto shrink-0">
        {WIZARD_STEPS.map((step, i) => (
          <button
            key={i}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors whitespace-nowrap min-h-[36px] sm:min-h-[28px]",
              i === currentStep && "bg-primary text-primary-foreground font-medium",
              i < currentStep && "text-primary cursor-pointer hover:bg-accent",
              i > currentStep && "text-muted-foreground"
            )}
            onClick={() => i < currentStep && setCurrentStep(i)}
            disabled={i > currentStep}
          >
            <span className={cn(
              "flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold border shrink-0",
              i === currentStep && "bg-primary-foreground text-primary border-transparent",
              i < currentStep && "bg-primary text-primary-foreground border-transparent",
              i > currentStep && "border-muted-foreground/30"
            )}>
              {i < currentStep ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn("hidden sm:inline", i === currentStep && "inline")}>{step.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-[5px] py-4 min-h-0">
        {stepContent}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 bg-card text-foreground">
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground hidden sm:block">
            {areas.length > 0 && `${areas.length} area${areas.length !== 1 ? "s" : ""} · R ${grandTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`}
          </div>
          {areas.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={handleSaveDraft}>
              <Save className="h-3 w-3" /> Save Draft
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0" onClick={goBack} disabled={currentStep === 0}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {currentStep === WIZARD_STEPS.length - 1 ? (
            <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={handleSave} disabled={areas.length === 0}>
              Add to Quote
            </Button>
          ) : (
            <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={goNext} disabled={!canNext}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
