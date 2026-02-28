import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Check, Wand2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { hapticTap } from "@/lib/haptics";
import { useBackButtonGuard } from "@/hooks/useBackButtonGuard";
import type { PaletteProduct, Basket, BasketItem } from "../QuoteBuilderTab";
import type { QuoteArea } from "./quoteWizardTypes";
import { WIZARD_STEPS, computeAreaSubtotal, createEmptyArea } from "./quoteWizardTypes";
import AreaDefinitionStep from "./wizard/AreaDefinitionStep";
import ACSelectionStep from "./wizard/ACSelectionStep";
import MaterialsStep from "./wizard/MaterialsStep";
import PricingStep from "./wizard/PricingStep";
import { TimeAllocationStep, ReviewStep } from "./wizard/PlaceholderSteps";

interface PaletteBundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  items: any[];
}

export interface WizardTriggerItem {
  name: string;
  code: string;
  description: string;
  price: number;
  category: import("./categorizePdfItem").PdfItemCategory;
  /** The wizard step to open on */
  step: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  products: PaletteProduct[];
  bundles: PaletteBundle[];
  onSave: (baskets: Basket[]) => void;
  /** Pre-fill from PDF click */
  triggerItem?: WizardTriggerItem | null;
  /** Trigger PDF scroll in background Visual Catalog */
  onPdfSearch?: (term: string) => void;
}

const DRAFT_STORAGE_KEY = "quote-builder-draft";

function saveDraftToStorage(areas: QuoteArea[], step: number) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ areas, step, savedAt: Date.now() }));
  } catch {
    // localStorage full or unavailable
  }
}

function loadDraftFromStorage(): { areas: QuoteArea[]; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.areas?.length > 0) return parsed;
  } catch {
    // corrupted
  }
  return null;
}

function clearDraftStorage() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function QuoteBuilderPopup({ open, onClose, products, bundles, onSave, triggerItem, onPdfSearch }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [areas, setAreas] = useState<QuoteArea[]>([]);

  // Capacitor: prevent hardware back button from leaving wizard
  const handleHardwareBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      hapticTap("light");
    } else {
      onClose();
    }
  }, [currentStep, onClose]);
  useBackButtonGuard(open, handleHardwareBack);

  // When opened with a triggerItem, jump to its step and ensure at least one area exists
  const lastTriggerId = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !triggerItem) return;
    const triggerId = `${triggerItem.code}-${triggerItem.price}`;
    if (lastTriggerId.current === triggerId) return;
    lastTriggerId.current = triggerId;

    // Ensure at least one area
    if (areas.length === 0) {
      setAreas([createEmptyArea("Room 1")]);
    }
    setCurrentStep(triggerItem.step);
  }, [open, triggerItem]);

  // Load draft on open (only if no triggerItem and no existing areas)
  useEffect(() => {
    if (!open || triggerItem || areas.length > 0) return;
    const draft = loadDraftFromStorage();
    if (draft) {
      setAreas(draft.areas);
      setCurrentStep(draft.step);
      toast.info("Draft restored from last session");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Convert areas to baskets
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
    onClose();
    setCurrentStep(0);
    setAreas([]);
    lastTriggerId.current = null;
    toast.success("Quote areas added successfully");
  }, [areas, onSave, onClose]);

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

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={(e) => { e.stopPropagation(); onClose(); }} />

      {/* Dialog */}
      <div className="relative z-10 bg-background border rounded-lg shadow-2xl max-w-3xl w-[95vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b shrink-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wand2 className="h-4 w-4" />
            Area Quote Builder
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Stepper — compact on mobile, full on desktop */}
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
              {/* Show label only for current step on mobile, all on desktop */}
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
    </div>,
    document.body
  );
}
