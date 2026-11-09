import { useEffect, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  ADMIN_HOME_BLOCKS_EVENT,
  ADMIN_HOME_BLOCKS_KEY,
  ADMIN_HOME_BLOCK_META,
  readAdminHomeBlocks,
  reorderAdminHomeBlocks,
  setAdminHomeBlockHidden,
  setAdminHomeBlockPinned,
  visibleAdminHomeBlocks,
  writeAdminHomeBlocks,
  type AdminHomeBlockId,
  type AdminHomeBlockPrefs,
} from "@/lib/adminHomeBlocks";

function useAdminHomeBlocks(storageKey: string) {
  const [prefs, setPrefs] = useState<AdminHomeBlockPrefs>(() => readAdminHomeBlocks(storageKey));
  useEffect(() => {
    setPrefs(readAdminHomeBlocks(storageKey));
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key && event.key !== storageKey) return;
      if (event instanceof CustomEvent && event.detail && event.detail !== storageKey) return;
      setPrefs(readAdminHomeBlocks(storageKey));
    };
    window.addEventListener(ADMIN_HOME_BLOCKS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ADMIN_HOME_BLOCKS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [storageKey]);
  const update = (next: AdminHomeBlockPrefs) => {
    const clean = writeAdminHomeBlocks(storageKey, next);
    setPrefs(clean);
    window.dispatchEvent(new CustomEvent(ADMIN_HOME_BLOCKS_EVENT, { detail: storageKey }));
  };
  return [prefs, update] as const;
}

function BlockFrame({
  id,
  pinned,
  children,
}: {
  id: AdminHomeBlockId;
  pinned: boolean;
  children: ReactNode;
}) {
  const meta = ADMIN_HOME_BLOCK_META[id];
  if (pinned) {
    return (
      <section
        data-testid={meta.testId}
        data-home-slot={id}
        data-pinned="true"
        className={id === "earlier" ? "space-y-3" : undefined}
      >
        {children}
      </section>
    );
  }
  return (
    <details
      data-testid={meta.testId}
      data-home-slot={id}
      data-pinned="false"
      className={meta.detailsClass}
    >
      <summary className="cursor-pointer px-2 py-1 text-sm font-semibold">{meta.title}</summary>
      {id === "next" ? children : <div className="space-y-3 pt-2">{children}</div>}
    </details>
  );
}

function SortableRow({
  id,
  hidden,
  pinned,
  onHidden,
  onPinned,
}: {
  id: AdminHomeBlockId;
  hidden: boolean;
  pinned: boolean;
  onHidden: (hidden: boolean) => void;
  onPinned: (pinned: boolean) => void;
}) {
  const title = ADMIN_HOME_BLOCK_META[id].title;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  const status = hidden
    ? (pinned ? "Hidden. It will open on the main page when you show it again." : "Hidden")
    : (pinned ? "On the main page" : "Collapsed section");
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`home-block-row-${id}`}
      data-hidden={hidden ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
      className={hidden
        ? "flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/40 px-2 py-2"
        : "flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2 py-2"}
    >
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-[#3D9BEB] touch-none active:cursor-grabbing"
        aria-label={`Drag to reorder ${title}`}
        data-testid={`home-block-handle-${id}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="min-w-[8.5rem] flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{status}</div>
      </div>
      <Button
        type="button"
        variant={hidden ? "default" : "outline"}
        className="min-h-11 shrink-0"
        aria-pressed={!hidden}
        data-testid={`home-block-visibility-${id}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onHidden(!hidden)}
      >
        {hidden ? "Show" : "Hide"}
      </Button>
      <Button
        type="button"
        variant={pinned ? "secondary" : "outline"}
        className="min-h-11 shrink-0"
        aria-pressed={pinned}
        data-testid={`home-block-pin-${id}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onPinned(!pinned)}
      >
        {pinned ? "Unpin from main page" : "Pin to main page"}
      </Button>
    </div>
  );
}

/**
 * The three Admin Home sections under Jobs being done.
 * Hidden sections are omitted from the page (no reserved slot) and stay in this list.
 * A pinned section is ordinary page content. The others stay collapsed bars.
 */
export default function AdminHomeBlockLayout({
  earlier,
  nextSteps,
  nextStepsPinned,
  moreDetails,
  storageKey = ADMIN_HOME_BLOCKS_KEY,
  startCustomizing = false,
}: {
  earlier: ReactNode;
  /** Inside the collapsed bar (inset, as it is today). */
  nextSteps: ReactNode;
  /** On the main page when pinned. Defaults to the collapsed contents. */
  nextStepsPinned?: ReactNode;
  moreDetails: ReactNode;
  storageKey?: string;
  startCustomizing?: boolean;
}) {
  const [prefs, update] = useAdminHomeBlocks(storageKey);
  const [customizing, setCustomizing] = useState(startCustomizing);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visible = visibleAdminHomeBlocks(prefs);
  const body: Record<AdminHomeBlockId, ReactNode> = {
    earlier,
    next: prefs.pinned.includes("next") ? (nextStepsPinned ?? nextSteps) : nextSteps,
    details: moreDetails,
  };

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId) return;
    update(reorderAdminHomeBlocks(prefs, String(event.active.id), String(overId)));
  };

  return (
    <div className="space-y-3" data-testid="home-blocks-flow" data-flow={visible.join(",")}>
      {visible.map((id) => (
        <BlockFrame key={id} id={id} pinned={prefs.pinned.includes(id)}>
          {body[id]}
        </BlockFrame>
      ))}
      <div data-testid="home-blocks-customise" data-home-control="true">
        {customizing ? (
          <div data-testid="home-blocks-customise-panel" className="rounded-2xl border bg-card/95 p-3 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Arrange these sections</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Drag a handle to change the order. Show or hide a section, or pin it so it stays open on the home page. Hiding does not delete anything.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                data-testid="home-blocks-customise-done"
                onClick={() => setCustomizing(false)}
              >
                Done
              </Button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={prefs.order} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {prefs.order.map((id) => (
                    <SortableRow
                      key={id}
                      id={id}
                      hidden={prefs.hidden.includes(id)}
                      pinned={prefs.pinned.includes(id)}
                      onHidden={(hidden) => update(setAdminHomeBlockHidden(prefs, id, hidden))}
                      onPinned={(pinned) => update(setAdminHomeBlockPinned(prefs, id, pinned))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ) : (
          <button
            type="button"
            data-testid="home-blocks-customise-open"
            onClick={() => setCustomizing(true)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border bg-card/95 px-3 py-2 text-left text-sm font-semibold shadow-sm"
          >
            <span>Arrange these sections</span>
            <span className="text-xs font-medium text-muted-foreground">Show, hide, or pin</span>
          </button>
        )}
      </div>
    </div>
  );
}
