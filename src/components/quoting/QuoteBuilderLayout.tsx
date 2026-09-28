import { useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const SIDE_PANEL_KEY = "qb.sidepanel.open";

/** Side panel open/closed, remembered per device. Closed by default. */
export function useSidePanelOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDE_PANEL_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDE_PANEL_KEY, open ? "1" : "0"); } catch { /* private mode */ }
  }, [open]);
  return [open, setOpen];
}

interface Props {
  /** Optional left column (product palette) on laptop/desktop. */
  left?: ReactNode;
  /** The working panel: areas + lines. Gets priority on space. */
  middle: ReactNode;
  /** Chosen items / totals — collapsed by default. */
  side: ReactNode;
  sideTitle?: string;
  /** Phone/tablet: side opens as a sheet instead of a rail. */
  compact: boolean;
  /** Height of any sticky bar below the middle panel, so the last line is never covered. */
  stickyPad?: string;
}

/**
 * Quote builder frame: every panel is its own scroll container (flex-col min-h-0,
 * overflow-y-auto body); the page itself never scrolls.
 */
export default function QuoteBuilderLayout({ left, middle, side, sideTitle = "Quote summary", compact, stickyPad = "1rem" }: Props) {
  const [open, setOpen] = useSidePanelOpen();

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {left && !compact && (
        <div className="flex w-[260px] shrink-0 flex-col min-h-0 overflow-hidden border-r">{left}</div>
      )}

      <div data-testid="qb-middle" className="flex min-w-0 flex-1 flex-col min-h-0 overflow-y-auto overscroll-contain">
        {middle}
        <div data-testid="qb-sticky-spacer" aria-hidden className="shrink-0" style={{ height: `calc(${stickyPad} + env(safe-area-inset-bottom, 0px))` }} />
      </div>

      {compact ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Show ${sideTitle.toLowerCase()}`}
            onClick={() => setOpen(true)}
            className="absolute right-2 top-2 z-20 h-8 gap-1 shadow"
          >
            <PanelRightOpen className="h-4 w-4" />
            <span className="text-xs">Summary</span>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col p-0">
              <SheetHeader className="shrink-0 border-b px-4 py-3"><SheetTitle className="text-sm">{sideTitle}</SheetTitle></SheetHeader>
              <div data-testid="qb-side-body" className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">{side}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : open ? (
        <aside data-testid="qb-side" data-state="open" className="flex w-[320px] shrink-0 flex-col min-h-0 border-l bg-card">
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
            <span className="text-xs font-semibold">{sideTitle}</span>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Hide summary" onClick={() => setOpen(false)}>
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
          <div data-testid="qb-side-body" className="min-h-0 flex-1 overflow-y-auto p-3">{side}</div>
        </aside>
      ) : (
        <aside data-testid="qb-side" data-state="closed" className="flex w-10 shrink-0 flex-col items-center border-l bg-card py-2">
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Show ${sideTitle.toLowerCase()}`} onClick={() => setOpen(true)}>
            <PanelRightOpen className="h-4 w-4" />
          </Button>
          <span className="mt-2 text-[10px] font-medium text-muted-foreground [writing-mode:vertical-rl]">{sideTitle}</span>
        </aside>
      )}
    </div>
  );
}
