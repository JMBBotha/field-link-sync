import { useState, useMemo, ReactNode, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, X, SlidersHorizontal, Search, ArrowUpDown, LayoutGrid, List, FolderTree } from "lucide-react";

export interface CatalogFilters {
  speedType: string;
  unitType: string;
  btu: string;
  refrigerant: string;
  phase: string;
  brand: string;
  pipeSize: string;
  priceMin: string;
  priceMax: string;
}

export type SortOption = "pinned" | "price_asc" | "price_desc" | "btu_asc" | "btu_desc" | "name";

export const DEFAULT_FILTERS: CatalogFilters = {
  speedType: "__all__",
  unitType: "__all__",
  btu: "__all__",
  refrigerant: "__all__",
  phase: "__all__",
  brand: "__all__",
  pipeSize: "__all__",
  priceMin: "",
  priceMax: "",
};

const SPEED_TYPES = ["Fixed Speed", "Inverter"];

const UNIT_TYPES = [
  "Midwall", "Cassette", "Ducted", "Under Ceiling", "Floor Standing",
  "Window Wall", "Portable", "Rooftop Package", "Air Cooled Chiller",
  "Accessories", "Large Ducted",
];

const BTU_OPTIONS = ["9K", "12K", "18K", "24K", "36K", "48K", "60K", "76K", "100K", "120K", "150K", "200K", "250K", "300K", "350K", "400K", "500K+"];

const REFRIGERANTS = ["R32", "R410A"];

const PHASES = [
  { label: "Single (1Ph)", value: "1Ph" },
  { label: "Three (3Ph)", value: "3Ph" },
];

export interface FilterCounts {
  speedType: Record<string, number>;
  unitType: Record<string, number>;
  btu: Record<string, number>;
  refrigerant: Record<string, number>;
  phase: Record<string, number>;
  brand: Record<string, number>;
  pipeSize: Record<string, number>;
}

interface Props {
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
  availableBrands: string[];
  availablePipeSizes: string[];
  totalCount: number;
  filteredCount: number;
  counts: FilterCounts;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  searchSuggestions?: ReactNode;
  onSearchFocus?: () => void;
  onSearchKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  viewMode: "grid" | "list" | "grouped";
  onViewModeChange: (mode: "grid" | "list" | "grouped") => void;
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14 shrink-0">{label}</span>
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
          {opt.count !== undefined && (
            <span className="ml-0.5 opacity-70 text-[10px]">({opt.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

const CatalogFilterBar = ({
  filters, onChange, availableBrands, availablePipeSizes,
  totalCount, filteredCount, counts,
  searchQuery, onSearchChange, sortBy, onSortChange,
  searchSuggestions, onSearchFocus, onSearchKeyDown,
  viewMode, onViewModeChange,
}: Props) => {
  const [showMore, setShowMore] = useState(false);

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
    if (filters.pipeSize !== "__all__") active.push({ key: "pipeSize", label: `Pipe: ${filters.pipeSize}` });
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

  const moreFilterCount = [filters.unitType, filters.phase, filters.brand, filters.pipeSize]
    .filter(v => v !== "__all__").length + (filters.priceMin ? 1 : 0) + (filters.priceMax ? 1 : 0);

  return (
    <div className="space-y-1.5">
      {/* ── ROW 1: Search + Speed + BTU + Refrigerant + Sort ── */}
      <div className="rounded-lg border bg-card/50 p-2.5 space-y-2">
        {/* Search + Sort row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search products, codes, brands…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={onSearchFocus}
              onKeyDown={onSearchKeyDown}
              className="h-8 pl-8 text-xs"
            />
            {searchSuggestions}
          </div>
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortOption)}>
            <SelectTrigger className="h-8 text-[11px] w-36 shrink-0">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              <SelectItem value="pinned">Pinned First</SelectItem>
              <SelectItem value="price_asc">Price: Low→High</SelectItem>
              <SelectItem value="price_desc">Price: High→Low</SelectItem>
              <SelectItem value="btu_asc">BTU: Low→High</SelectItem>
              <SelectItem value="btu_desc">BTU: High→Low</SelectItem>
              <SelectItem value="name">Model A-Z</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border rounded-md overflow-hidden shrink-0">
            <button
              onClick={() => onViewModeChange("grid")}
              className={`p-1.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange("list")}
              className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange("grouped")}
              className={`p-1.5 transition-colors ${viewMode === "grouped" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              title="Group by category"
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Primary filters inline */}
        <div className="space-y-1.5">
          <ChipGroup
            label="Speed"
            options={SPEED_TYPES.map((s) => ({ label: s, value: s, count: counts.speedType[s] ?? 0 }))}
            value={filters.speedType}
            onChange={(v) => set("speedType", v)}
          />

        <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14 shrink-0">BTU</span>
            <Select value={filters.btu} onValueChange={(v) => set("btu", v)}>
              <SelectTrigger className="h-7 text-[11px] w-28">
                <SelectValue placeholder="All BTU" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="__all__">All BTU</SelectItem>
                {BTU_OPTIONS.filter((b) => (counts.btu[b] ?? 0) > 0).map((b) => (
                  <SelectItem key={b} value={b}>{b} ({counts.btu[b]})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ChipGroup
            label="Refrig."
            options={REFRIGERANTS.map((r) => ({ label: r, value: r, count: counts.refrigerant[r] ?? 0 }))}
            value={filters.refrigerant}
            onChange={(v) => set("refrigerant", v)}
          />
        </div>

        {/* Count + More filters toggle */}
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <SlidersHorizontal className="h-3 w-3" />
            {showMore ? "Hide filters" : "More filters"}
            {moreFilterCount > 0 && !showMore && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{moreFilterCount}</Badge>
            )}
            {showMore ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {filteredCount} of {totalCount}
          </span>
        </div>
      </div>

      {/* ── ROW 2: Expanded filters ── */}
      {showMore && (
        <div className="rounded-lg border bg-card/50 p-2.5 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Type</span>
            <Select value={filters.unitType} onValueChange={(v) => set("unitType", v)}>
              <SelectTrigger className="h-7 text-[11px] w-44">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="__all__">All Types</SelectItem>
                {UNIT_TYPES.map((t) => {
                  const c = counts.unitType[t] ?? 0;
                  return <SelectItem key={t} value={t}>{t} ({c})</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>

          <ChipGroup
            label="Phase"
            options={PHASES.map((p) => ({ label: p.label, value: p.value, count: counts.phase[p.value] ?? 0 }))}
            value={filters.phase}
            onChange={(v) => set("phase", v)}
          />

          <ChipGroup
            label="Brand"
            options={[...availableBrands].sort().map((b) => ({ label: b, value: b, count: counts.brand[b] ?? 0 }))}
            value={filters.brand}
            onChange={(v) => set("brand", v)}
          />

          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Pipe</span>
            <Select value={filters.pipeSize} onValueChange={(v) => set("pipeSize", v)}>
              <SelectTrigger className="h-7 text-[11px] w-44">
                <SelectValue placeholder="All Pipe Sizes" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="__all__">All Pipe Sizes</SelectItem>
                {availablePipeSizes.map((ps) => {
                  const c = counts.pipeSize[ps] ?? 0;
                  return <SelectItem key={ps} value={ps}>{ps} ({c})</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Price</span>
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
      )}

      {/* ── Active filter chips ── */}
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
