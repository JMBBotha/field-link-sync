/**
 * Inline (non-modal) version of the Area Quote Builder wizard.
 * Renders the same stepper + steps + footer but as a permanent panel
 * that fills its parent container.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Check, Wand2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { hapticTap } from "@/lib/haptics";
import type { PaletteProduct, Basket, BasketItem } from "../QuoteBuilderTab";
import type { QuoteArea } from "./quoteWizardTypes";
import { WIZARD_STEPS, computeAreaSubtotal, createEmptyArea } from "./quoteWizardTypes";
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
    if (parsed?.areas?.length > 0) return parsed;
  } catch { /* corrupted */ }
  return null;
}

function clearDraftStorage() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
}

export default function AreaQuoteBuilderInline({ products, bundles, onSave, onPdfSearch, onAreasChange }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [areas, setAreas] = useState<QuoteArea[]>(() => {
    const draft = loadDraftFromStorage();
    if (draft) return draft.areas;
    return [createEmptyArea("Room 1")];
  });

  // Load draft step on mount
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const draft = loadDraftFromStorage();
    if (draft) {
      setCurrentStep(draft.step);
      toast.info("Draft restored from last session");
    }
  }, []);

  // Notify parent of area changes
  useEffect(() => {
    onAreasChange?.(areas);
  }, [areas, onAreasChange]);

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
      const acItems: BasketItem[] = area.acUnits.map((u) => ({
        instanceId: `${u.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: u.product,
        quantity: u.quantity,
      }));
      if (acItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}-ac`, name: `${area.name} AC`, items: acItems });
      }

      const matItems: BasketItem[] = area.materials.map((m) => ({
        instanceId: `${m.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: m.product,
        quantity: m.pricingMode === "unit" ? m.unitQuantity : 1,
        ...(m.pricingMode === "length" ? { length: m.adjustedLength } : {}),
      }));
      if (matItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}-mat`, name: `${area.name} Piping`, items: matItems });
      }

      const consItems: BasketItem[] = area.consumables.map((c) => ({
        instanceId: `${c.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: c.product,
        quantity: c.quantity,
      }));
      if (consItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}-cons`, name: `${area.name} Electrical`, items: consItems });
      }
    }
    onSave(baskets);
    clearDraftStorage();
    setCurrentStep(0);
    setAreas([createEmptyArea("Room 1")]);
    toast.success("Quote areas added successfully");
  }, [areas, onSave]);

  const stepContent = useMemo(() => {
    const props = { areas, onAreasChange: setAreas };
    switch (currentStep) {
      case 0: return <AreaDefinitionStep {...props} />;
      case 1: return <ACSelectionStep {...props} products={products} bundles={bundles} onPdfSearch={onPdfSearch} />;
      case 2: return <PricingStep {...props} />;
      case 3: return <TimeAllocationStep {...props} />;
      case 4: return <ReviewStep {...props} />;
      default: return null;
    }
  }, [currentStep, areas, products, bundles, onPdfSearch]);

  const grandTotal = useMemo(() => areas.reduce((s, a) => s + computeAreaSubtotal(a), 0), [areas]);

  return (
    <div className="h-full flex flex-col bg-card rounded-lg shadow overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Wand2 className="h-5 w-5 text-primary" />
          Build Area Quote
        </h2>
      </div>

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
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {stepContent}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 bg-muted/30">
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
