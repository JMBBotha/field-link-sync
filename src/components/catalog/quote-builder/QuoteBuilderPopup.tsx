import { useState, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PaletteProduct, Basket, BasketItem } from "../QuoteBuilderTab";
import type { QuoteArea } from "./quoteWizardTypes";
import { WIZARD_STEPS, computeAreaSubtotal } from "./quoteWizardTypes";
import AreaDefinitionStep from "./wizard/AreaDefinitionStep";
import ACSelectionStep from "./wizard/ACSelectionStep";
import MaterialsStep from "./wizard/MaterialsStep";
import { TimeAllocationStep, ReviewStep } from "./wizard/PlaceholderSteps";

interface PaletteBundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  items: any[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  products: PaletteProduct[];
  bundles: PaletteBundle[];
  onSave: (baskets: Basket[]) => void;
}

export default function QuoteBuilderPopup({ open, onClose, products, bundles, onSave }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [areas, setAreas] = useState<QuoteArea[]>([]);

  const canNext = useMemo(() => {
    if (currentStep === 0) return areas.length > 0 && areas.every((a) => a.name.trim().length > 0);
    if (currentStep === 1) return areas.every((a) => a.acUnits.length > 0);
    return true;
  }, [currentStep, areas]);

  const goNext = useCallback(() => {
    if (currentStep < WIZARD_STEPS.length - 1 && canNext) setCurrentStep((s) => s + 1);
  }, [currentStep, canNext]);

  const goBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  }, [currentStep]);

  const handleSave = useCallback(() => {
    // Convert areas to baskets
    const baskets: Basket[] = [];
    for (const area of areas) {
      // AC basket
      const acItems: BasketItem[] = area.acUnits.map((u) => ({
        instanceId: `${u.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: u.product,
        quantity: u.quantity,
      }));
      if (acItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}-ac`, name: `${area.name} AC`, items: acItems });
      }

      // Materials basket
      const matItems: BasketItem[] = area.materials.map((m) => ({
        instanceId: `${m.product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product: m.product,
        quantity: 1,
        length: m.adjustedLength,
      }));
      if (matItems.length > 0) {
        baskets.push({ id: `basket-${Date.now()}-${area.id}-mat`, name: `${area.name} Piping`, items: matItems });
      }

      // Consumables basket
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
    onClose();
    setCurrentStep(0);
    setAreas([]);
  }, [areas, onSave, onClose]);

  const stepContent = useMemo(() => {
    const props = { areas, onAreasChange: setAreas };
    switch (currentStep) {
      case 0: return <AreaDefinitionStep {...props} />;
      case 1: return <ACSelectionStep {...props} products={products} />;
      case 2: return <MaterialsStep {...props} bundles={bundles} products={products} />;
      case 3: return <TimeAllocationStep {...props} />;
      case 4: return <ReviewStep {...props} />;
      default: return null;
    }
  }, [currentStep, areas, products, bundles]);

  const grandTotal = useMemo(() => areas.reduce((s, a) => s + computeAreaSubtotal(a), 0), [areas]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" />
            Area Quote Builder
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-4 py-3 border-b overflow-x-auto shrink-0">
          {WIZARD_STEPS.map((step, i) => (
            <button
              key={i}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap",
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
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          {stepContent}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 bg-muted/30">
          <div className="text-xs text-muted-foreground">
            {areas.length > 0 && `${areas.length} area${areas.length !== 1 ? "s" : ""} · R ${grandTotal.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={goBack} disabled={currentStep === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {currentStep === WIZARD_STEPS.length - 1 ? (
              <Button size="sm" onClick={handleSave} disabled={areas.length === 0}>
                Add to Quote
              </Button>
            ) : (
              <Button size="sm" onClick={goNext} disabled={!canNext}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
