import { useEffect, useState } from "react";
import PriceListSheet from "@/components/quoting/PriceListSheet";

/** iPhone 14 portrait insets. The sheet still reads env() when these variables are absent. */
const IPHONE_14_TOP = "47px";
const IPHONE_14_BOTTOM = "34px";

/** Dev-only shots of the quote-builder price list. Demo rows, not a live catalogue. */
export default function PriceListSheetHarness() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--fl-pricelist-safe-top", IPHONE_14_TOP);
    root.style.setProperty("--fl-pricelist-safe-bottom", IPHONE_14_BOTTOM);
    return () => {
      root.style.removeProperty("--fl-pricelist-safe-top");
      root.style.removeProperty("--fl-pricelist-safe-bottom");
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#e8f4fc]" data-testid="pricelist-sheet-harness">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[400] flex items-end justify-between bg-[#3D9BEB] px-5 pb-1.5 text-[13px] font-semibold text-white"
        style={{ height: IPHONE_14_TOP }}
        data-testid="demo-status-bar"
      >
        <span>09:20</span>
        <span>Demo</span>
        <span>5G</span>
      </div>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[400] flex items-end justify-center bg-[#3D9BEB] pb-2"
        style={{ height: IPHONE_14_BOTTOM }}
        data-testid="demo-home-bar"
      >
        <span className="h-1 w-28 rounded-full bg-white/90" />
      </div>
      <div className="px-4 pt-16 text-[#0F2A44]">
        <p className="text-sm font-semibold">Quote builder</p>
        <p className="text-xs">Demo — harness, not live client data</p>
        {!open && (
          <button type="button" className="mt-4 inline-flex h-11 items-center rounded-full bg-[#C2410C] px-4 text-sm font-semibold text-white" onClick={() => setOpen(true)} data-testid="pricelist-reopen">
            Open price list
          </button>
        )}
      </div>
      <PriceListSheet
        open={open}
        onOpenChange={setOpen}
        phone
        demo={{ label: "Demo wall-mount price list", heading: "Residential series" }}
      />
    </div>
  );
}
