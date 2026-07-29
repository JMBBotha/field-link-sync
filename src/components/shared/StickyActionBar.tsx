import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom padding that MUST be applied to the scroll container / form wrapper that
 * renders a <StickyActionBar />, so the last content row is never hidden behind
 * the sticky bar + the global fixed footer / bottom nav.
 */
export const STICKY_ACTION_BAR_SPACER = "pb-28 lg:pb-24";

interface StickyActionBarProps {
  children: ReactNode;
  /** Horizontal alignment of the actions. */
  align?: "start" | "center" | "end" | "between";
  /** Extra classes (avoid overriding the bottom offset). */
  className?: string;
}

const alignMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

/**
 * Standard bottom action bar for forms/panels rendered inside a page (not a modal).
 *
 * It sticks ABOVE the global fixed footer (h-16 mobile bottom nav / h-12 desktop footer),
 * so Save/Cancel buttons are always fully visible and clickable.
 */
const StickyActionBar = ({ children, align = "end", className }: StickyActionBarProps) => {
  return (
    <div
      data-testid="sticky-action-bar"
      className={cn(
        "sticky bottom-16 lg:bottom-12 z-30 -mx-4 px-4 py-3",
        "flex flex-wrap items-center gap-2",
        alignMap[align],
        "border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      {children}
    </div>
  );
};

export default StickyActionBar;
