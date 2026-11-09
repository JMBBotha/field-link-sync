import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import PriceListPane, { type PriceListDemo } from "@/components/quoting/PriceListPane";

/**
 * Notch clearance for this sheet only. A real phone uses env(safe-area-inset-*).
 * The demo harness may set --fl-pricelist-safe-top / --fl-pricelist-safe-bottom
 * so a desktop screenshot can show the same gap. Other sheets stay on top-4.
 */
const SAFE_TOP = "calc(var(--fl-pricelist-safe-top, env(safe-area-inset-top, 0px)) + 0.75rem)";
const SAFE_BOTTOM = "calc(var(--fl-pricelist-safe-bottom, env(safe-area-inset-bottom, 0px)) + 0.75rem)";

/** Phone/tablet price list. Full width on a phone; 60vw from tablets up, same as before. */
export default function PriceListSheet({ open, onOpenChange, phone, demo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: boolean;
  demo?: PriceListDemo;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeClassName="top-[calc(var(--fl-pricelist-safe-top,env(safe-area-inset-top,0px))+0.75rem)] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-background opacity-100 shadow-sm"
        className={`${phone ? "w-full max-w-none sm:max-w-none" : "w-[60vw] max-w-[60vw] sm:max-w-[60vw]"} fl-builder flex h-full flex-col gap-2 overflow-hidden px-3 pt-[calc(var(--fl-pricelist-safe-top,env(safe-area-inset-top,0px))+0.75rem)] pb-[calc(var(--fl-pricelist-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)]`}
        style={{ paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM }}
        aria-describedby={undefined}
        data-testid="pricelist-sheet"
      >
        <SheetHeader className="h-11 shrink-0 flex-row items-center space-y-0 pr-12 text-left">
          <SheetTitle className="text-sm">Price list</SheetTitle>
        </SheetHeader>
        <PriceListPane heightClass="min-h-0 flex-1" onClose={() => onOpenChange(false)} demo={demo} />
      </SheetContent>
    </Sheet>
  );
}
