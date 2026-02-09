import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { X, Package } from "lucide-react";
import ProductCatalogBrowser from "@/components/catalog/ProductCatalogBrowser";

interface CatalogPickerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToQuote: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const CatalogPickerDrawer = ({ open, onOpenChange, onAddToQuote }: CatalogPickerDrawerProps) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] flex flex-col p-0" hideCloseButton>
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Product Catalog</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ProductCatalogBrowser onAddToQuote={(item) => { onAddToQuote(item); }} />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CatalogPickerDrawer;
