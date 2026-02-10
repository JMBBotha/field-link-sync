import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, X, SlidersHorizontal } from "lucide-react";

export interface CatalogFilters {
  speedType: string;
  unitType: string;
  btu: string;
  refrigerant: string;
  phase: string;
  brand: string;
  priceMin: string;
  priceMax: string;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  speedType: "__all__",
  unitType: "__all__",
  btu: "__all__",
  refrigerant: "__all__",
  phase: "__all__",
  brand: "__all__",
  priceMin: "",
  priceMax: "",
};

const SPEED_TYPES = ["Fixed Speed", "Inverter"];

const UNIT_TYPES = [
  "Midwall", "Cassette", "Ducted", "Under Ceiling", "Floor Standing",
  "Window Wall", "Portable", "Rooftop Package", "Air Cooled Chiller",
  "Accessories", "Large Ducted",
];

const BTU_OPTIONS = ["9K", "12K", "18K", "24K", "34K", "36K", "48K", "60K", "76K+"];

const REFRIGERANTS = ["R32", "R410A"];

const PHASES = [
  { label: "Single Phase (1Ph)", value: "1Ph" },
  { label: "Three Phase (3Ph)", value: "3Ph" },
];

interface Props {
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
  availableBrands: string[];
  totalCount: number;
  filteredCount: number;
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">{label}</span>
      <button
        onClick={() => onChange("__all__")}
        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border ${
          value === "__all__"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
        }`}
      >
        All
      </button>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(value === opt.value ? "__all__" : opt.value)}
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border ${
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const CatalogFilterBar = ({ filters, onChange, availableBrands, totalCount, filteredCount }: Props) => {
  const [isOpen, setIsOpen] = useState(true);

  const set = (key: keyof CatalogFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  const activeFilters = useMemo(() => {
    const active: { key: keyof CatalogFilters; label: string }[] = [];
    if (filters.speedType !== "__all__") active.push({ key: "speedType", label: `Speed: ${filters.speedType}` });
    if (filters.unitType !== "__all__") active.push({ key: "unitType", label: `Type: ${filters.unitType}` });
    if (filters.btu !== "__all__") active.push({ key: "btu", label: `BTU: ${filters.btu}` });
    if (filters.refrigerant !== "__all__") active.push({ key: "refrigerant", label: filters.refrigerant });
    if (filters.phase !== "__all__") active.push({ key: "phase", label: `Phase: ${filters.phase}` });
    if (filters.brand !== "__all__") active.push({ key: "brand", label: `Brand: ${filters.brand}` });
    if (filters.priceMin) active.push({ key: "priceMin", label: `Min: R${filters.priceMin}` });
    if (filters.priceMax) active.push({ key: "priceMax", label: `Max: R${filters.priceMax}` });
    return active;
  }, [filters]);

  const hasActiveFilters = activeFilters.length > 0;

  const clearAll = () => onChange({ ...DEFAULT_FILTERS });

  const removeFilter = (key: keyof CatalogFilters) => {
    const defaults: Record<string, string> = { priceMin: "", priceMax: "" };
    set(key, defaults[key] ?? "__all__");
  };

  return (
    <div className="space-y-2">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground px-2 h-7">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {hasActiveFilters && (
                <Badge variant="secondary" className="text-[10px] ml-1 px-1.5">{activeFilters.length}</Badge>
              )}
              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </CollapsibleTrigger>
          <div className="text-xs text-muted-foreground">
            {filteredCount} of {totalCount} products
          </div>
        </div>

        <CollapsibleContent className="mt-2">
          <div className="rounded-lg border bg-card/50 p-3 space-y-2">
            <ChipGroup
              label="Speed"
              options={SPEED_TYPES.map((s) => ({ label: s, value: s }))}
              value={filters.speedType}
              onChange={(v) => set("speedType", v)}
            />

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">Type</span>
              <Select value={filters.unitType} onValueChange={(v) => set("unitType", v)}>
                <SelectTrigger className="h-7 text-[11px] w-36">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Types</SelectItem>
                  {UNIT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">BTU</span>
              <Select value={filters.btu} onValueChange={(v) => set("btu", v)}>
                <SelectTrigger className="h-7 text-[11px] w-28">
                  <SelectValue placeholder="All BTU" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All BTU</SelectItem>
                  {BTU_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ChipGroup
              label="Refrig."
              options={REFRIGERANTS.map((r) => ({ label: r, value: r }))}
              value={filters.refrigerant}
              onChange={(v) => set("refrigerant", v)}
            />

            <ChipGroup
              label="Phase"
              options={PHASES.map((p) => ({ label: p.label, value: p.value }))}
              value={filters.phase}
              onChange={(v) => set("phase", v)}
            />

            <ChipGroup
              label="Brand"
              options={[...availableBrands].sort().map((b) => ({ label: b, value: b }))}
              value={filters.brand}
              onChange={(v) => set("brand", v)}
            />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">Price</span>
              <Input
                type="number"
                placeholder="Min"
                value={filters.priceMin}
                onChange={(e) => set("priceMin", e.target.value)}
                className="h-7 text-[11px] w-24"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                placeholder="Max"
                value={filters.priceMax}
                onChange={(e) => set("priceMax", e.target.value)}
                className="h-7 text-[11px] w-24"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {hasActiveFilters && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeFilters.map((f) => (
            <Badge key={f.key} variant="secondary" className="text-[10px] gap-1 pr-1">
              {f.label}
              <button onClick={() => removeFilter(f.key)} className="ml-0.5 hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
          <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};

export default CatalogFilterBar;
