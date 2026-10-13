import { LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";

/** Sidebar "Settings & account" row that flips Classic <-> New layout. */
export default function LayoutToggleButton({ collapsed }: { collapsed?: boolean }) {
  const { isClassic, toggle } = useLayoutVersion();
  return (
    <button onClick={toggle} data-testid="layout-toggle" title={isClassic ? "Switch to the new layout" : "Switch to the classic layout"}
      className={cn("w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] text-nav-muted transition-colors hover:text-nav-foreground hover:bg-white/[0.06]", collapsed && "justify-center px-0")}>
      <LayoutTemplate className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span>Layout: {isClassic ? "Classic" : "New"} <span className="opacity-70">· switch</span></span>}
    </button>
  );
}
