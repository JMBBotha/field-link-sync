import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import FlatRateBook from "./FlatRateBook";

interface FlatRatePickerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToQuote: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const FlatRatePickerDrawer = ({ open, onOpenChange, onAddToQuote }: FlatRatePickerDrawerProps) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Flat Rate Pricing Book</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <FlatRateBook
            mode="picker"
            onAddToQuote={(item) => {
              onAddToQuote(item);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default FlatRatePickerDrawer;
