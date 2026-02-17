import { useState } from "react";
import { Plus, Trash2, Home, Tv, Briefcase, BedDouble } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function AreaDefinitionStep({ areas, onAreasChange }: Props) {
  const [newName, setNewName] = useState("");

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define the areas/rooms for this installation. Each area will get its own AC unit, materials, and consumables.
      </p>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const count = areas.filter((a) => a.name.startsWith(p.label)).length;
          const name = count > 0 ? `${p.label} ${count + 1}` : p.label;
          return (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => addArea(name)}
            >
              <p.icon className="h-3.5 w-3.5" />
              Add {p.label}
            </Button>
          );
        })}
      </div>

      {/* Custom name input */}
      <div className="flex gap-2">
        <Input
          placeholder="Custom area name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addArea(newName)}
          className="h-9 text-sm"
        />
        <Button size="sm" onClick={() => addArea(newName)} disabled={!newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {/* Area list */}
      {areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No areas defined yet. Use the presets above or type a custom name.
        </div>
      ) : (
        <div className="space-y-2">
          {areas.map((area, i) => (
            <div
              key={area.id}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
            >
              <span className="text-xs font-medium text-muted-foreground w-6">{i + 1}.</span>
              <Input
                value={area.name}
                onChange={(e) => renameArea(area.id, e.target.value)}
                className="h-8 text-sm flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => removeArea(area.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
