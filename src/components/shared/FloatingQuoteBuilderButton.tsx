import { useState } from "react";
import { PenTool, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import QuoteBuilderTab from "@/components/catalog/QuoteBuilderTab";

const FloatingQuoteBuilderButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all"
        size="icon"
        title="Open Quote Builder"
      >
        <PenTool className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[95vw] md:max-w-[90vw] p-0 overflow-hidden">
          <SheetHeader className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2">
                <PenTool className="h-4 w-4" />
                Quote Builder
              </SheetTitle>
            </div>
          </SheetHeader>
          <div className="h-[calc(100vh-60px)] overflow-auto">
            <QuoteBuilderTab />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default FloatingQuoteBuilderButton;
