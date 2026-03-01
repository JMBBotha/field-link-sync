import { useState, useMemo } from "react";
import { Plus, Trash2, Home, Tv, Briefcase, BedDouble, GripVertical, Factory, ChevronDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QuoteArea } from "../quoteWizardTypes";
import { createEmptyArea } from "../quoteWizardTypes";

interface Props {
  areas: QuoteArea[];
  onAreasChange: (areas: QuoteArea[]) => void;
}

// Category-specific area options
const CATEGORY_AREAS: Record<string, string[]> = {
  residential: ["Living Area", "Bedroom", "Kitchen", "Bathroom", "Dining Room", "Garage", "Study", "Patio", "Laundry", "Office"],
  office: ["Reception", "Open Plan", "Server Room", "Boardroom", "Break Room", "Corner Office", "Meeting Room", "Storage"],
  retail: ["Shop Floor", "Storeroom", "Office", "Fitting Room", "Display Area", "Cashier Area", "Loading Bay"],
  industrial: ["Factory Floor", "Warehouse", "Control Room", "Loading Dock", "Break Room", "Office", "Cold Storage", "Workshop"],
};

// Template zone names mapped to categories for detection
const TEMPLATE_ZONES: Record<string, string[]> = {
  residential: ["Living Area", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Kitchen"],
  office: ["Reception", "Open Plan", "Server Room", "Boardroom", "Office"],
  retail: ["Shop Floor", "Storeroom", "Office"],
  industrial: ["Factory Floor", "Warehouse", "Control Room", "Loading Dock"],
};

function detectCategory(areas: QuoteArea[]): string | null {
  if (areas.length === 0) return null;
  const names = areas.map((a) => a.name.replace(/\s*\d+$/, ""));
  for (const [cat, zones] of Object.entries(TEMPLATE_ZONES)) {
    const catBase = zones.map((z) => z.replace(/\s*\d+$/, ""));
    if (names.some((n) => catBase.includes(n))) return cat;
  }
  for (const [cat, options] of Object.entries(CATEGORY_AREAS)) {
    if (names.some((n) => options.includes(n))) return cat;
  }
  return null;
}

function SortableAreaRow({
  area, index, onRename, onRemove,
}: {
  area: QuoteArea; index: number;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: area.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/50 hover:text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-xs font-medium text-muted-foreground w-6">{index + 1}.</span>
      <Input
        value={area.name}
        onChange={(e) => onRename(area.id, e.target.value)}
        className="h-8 text-sm flex-1"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={() => onRemove(area.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function AreaDefinitionStep({ areas, onAreasChange }: Props) {
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const detectedCategory = useMemo(() => detectCategory(areas), [areas]);

  // Build dropdown options: category-relevant areas filtered out already-added ones
  const dropdownOptions = useMemo(() => {
    const category = detectedCategory || "residential";
    const options = CATEGORY_AREAS[category] || CATEGORY_AREAS.residential;
    return options.filter((opt) => {
      // Allow adding duplicates with incrementing numbers
      return true;
    });
  }, [detectedCategory]);

  const addArea = (name: string) => {
    if (!name.trim()) return;
    // Auto-increment if duplicate
    const baseName = name.trim();
    const count = areas.filter((a) => a.name === baseName || a.name.startsWith(baseName + " ")).length;
    const finalName = count > 0 ? `${baseName} ${count + 1}` : baseName;
    onAreasChange([...areas, createEmptyArea(finalName)]);
    setCustomName("");
    setCustomMode(false);
  };

  const removeArea = (id: string) => {
    onAreasChange(areas.filter((a) => a.id !== id));
  };

  const renameArea = (id: string, name: string) => {
    onAreasChange(areas.map((a) => (a.id === id ? { ...a, name } : a)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = areas.findIndex((a) => a.id === active.id);
    const newIndex = areas.findIndex((a) => a.id === over.id);
    onAreasChange(arrayMove(areas, oldIndex, newIndex));
  };

  const categoryLabel = detectedCategory
    ? detectedCategory.charAt(0).toUpperCase() + detectedCategory.slice(1)
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define the areas/rooms for this installation. Each area will get its own AC unit, materials, and consumables. Drag to reorder.
      </p>

      {/* Area chips when areas exist, otherwise show presets */}
      <div className="flex flex-wrap gap-2">
        {areas.length > 0 ? (
          areas.map((area) => (
            <Button
              key={area.id}
              variant="secondary"
              size="sm"
              className="gap-1.5 min-h-[44px] sm:min-h-0 font-semibold"
            >
              <Home className="h-3.5 w-3.5" />
              {area.name}
            </Button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground italic">Choose a template or add areas below.</p>
        )}
      </div>

      {/* Add Area dropdown + custom input */}
      <div className="flex gap-2">
        {customMode ? (
          <>
            <Input
              autoFocus
              placeholder="Enter custom area name..."
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addArea(customName);
                if (e.key === "Escape") setCustomMode(false);
              }}
              className="h-11 sm:h-9 text-sm flex-1"
            />
            <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => addArea(customName)} disabled={!customName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
            <Button variant="ghost" size="sm" className="min-h-[44px] sm:min-h-0 text-xs" onClick={() => setCustomMode(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 min-h-[44px] sm:min-h-0">
                <Plus className="h-4 w-4" />
                Add Area
                <ChevronDown className="h-3 w-3 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {categoryLabel && (
                <>
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    {categoryLabel} Areas
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              {dropdownOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt}
                  className="text-xs cursor-pointer gap-2"
                  onClick={() => addArea(opt)}
                >
                  <Home className="h-3 w-3 text-muted-foreground" />
                  {opt}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs cursor-pointer gap-2"
                onClick={() => setCustomMode(true)}
              >
                <Pencil className="h-3 w-3 text-muted-foreground" />
                Custom...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Area list */}
      {areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Home className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-medium">No areas yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add a room to start building your quote — use a template or the Add Area button above.</p>
          </div>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={areas.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {areas.map((area, i) => (
                <SortableAreaRow
                  key={area.id}
                  area={area}
                  index={i}
                  onRename={renameArea}
                  onRemove={removeArea}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
