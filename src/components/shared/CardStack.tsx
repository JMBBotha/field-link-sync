/**
 * Playing-card stacks (pipeline Stages pattern), shared by PipelineBoard and the tech /field panel.
 * A back card peeks as a slim strip; it opens on mouse hover (leave closes) or click/tap (pinned until tapped again).
 * Markup contract: data-card-stack="back|front", data-peek-open="true|false", data-peek-body.
 */
import { useCallback, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function usePeekStack<K extends string>(initialPinned: K[] = []) {
  const [hover, setHover] = useState<K | null>(null);
  const [pinned, setPinned] = useState<Set<K>>(() => new Set(initialPinned));
  const toggle = useCallback((key: K) => setPinned((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), []);
  const enter = (key: K) => (e: PointerEvent) => { if (e.pointerType === "mouse") setHover(key); };
  const leave = (key: K) => (e: PointerEvent) => { if (e.pointerType === "mouse") setHover((h) => (h === key ? null : h)); };
  const isOpen = (key: K) => pinned.has(key) || hover === key;
  return { hover, pinned, toggle, enter, leave, isOpen };
}

/** Animated open/close body (grid-rows 0fr→1fr); closed bodies are inert and hidden from screen readers. */
export function PeekBody({ open, id, children, className }: { open: boolean; id?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      aria-hidden={!open || undefined} data-peek-body={id}
      {...({ inert: open ? undefined : "" } as Record<string, unknown>)}>
      <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
    </div>
  );
}

/** Back card of a stack: slim header strip when closed, full body when open. */
export function PeekCard({ id, open, onToggle, onPointerEnter, onPointerLeave, title, summary, children, className, bodyClassName, overlap = "none" }: {
  id: string; open: boolean; onToggle: () => void;
  onPointerEnter?: (e: PointerEvent) => void; onPointerLeave?: (e: PointerEvent) => void;
  title: ReactNode; summary?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
  /** "below": this card tucks under the card above it (peeks out underneath). */
  overlap?: "none" | "below";
}) {
  return (
    <div data-card-stack="back" data-peek-open={open ? "true" : "false"} data-stack-id={id}
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
      className={cn("relative z-0 flex min-w-0 flex-col rounded-xl border border-border/60 bg-card shadow-sm transition-[margin] duration-300",
        !open && "mx-2 bg-muted", overlap === "below" && "-mt-3 pt-3", className)}>
      <button type="button" data-no-min aria-expanded={open} aria-controls={`peek-${id}`} onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-foreground">
        <span className="flex min-w-0 items-center gap-1.5 truncate">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">{summary}{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
      </button>
      <div id={`peek-${id}`}><PeekBody open={open} id={id} className={bodyClassName}>{children}</PeekBody></div>
      {!open && overlap === "none" && <div className="h-2.5" aria-hidden />}
    </div>
  );
}

/** Front card class: overlaps the back card above it with a top shadow. */
export const frontCardClass = "relative z-10 -mt-3 rounded-xl border border-border/60 bg-card shadow-[0_-6px_14px_-8px_rgba(0,0,0,0.35)]";
