import { useState } from "react";
import { Plus, Trash2, Home, Tv, Briefcase, BedDouble, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const PRESETS = [
  { label: "Bedroom", icon: BedDouble },
  { label: "Living Room", icon: Tv },
  { label: "Office", icon: Briefcase },
  { label: "Kitchen", icon: Home },
];

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
  const [newName, setNewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const addArea = (name: string) => {
    if (!name.trim()) return;
    onAreasChange([...areas, createEmptyArea(name.trim())]);
    setNewName("");
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
          PRESETS.map((p) => {
            const count = areas.filter((a) => a.name.startsWith(p.label)).length;
            const name = count > 0 ? `${p.label} ${count + 1}` : p.label;
            return (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                className="gap-1.5 min-h-[44px] sm:min-h-0"
                onClick={() => addArea(name)}
              >
                <p.icon className="h-3.5 w-3.5" />
                Add {p.label}
              </Button>
            );
          })
        )}
      </div>

      {/* Custom name input */}
      <div className="flex gap-2">
        <Input
          placeholder="Custom area name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addArea(newName)}
          className="h-11 sm:h-9 text-sm"
        />
        <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => addArea(newName)} disabled={!newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {/* Area list */}
      {areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Home className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-medium">No areas yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add a room to start building your quote — use the presets above or type a custom name.</p>
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
