import { useState, useMemo, ReactNode, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, X, SlidersHorizontal, Search, ArrowUpDown, LayoutGrid, List, FolderTree } from "lucide-react";
import { type ProductCategory, getFilterConfig, type FilterDimension } from "./categoryFilterConfig";

export interface CatalogFilters {
  // AC-specific
  speedType: string;
  unitType: string;
  btu: string;
  refrigerant: string;
  phase: string;
  pipeSize: string;
  // Water Heaters
  whCapacity: string;
  whType: string;
  whMounting: string;
  whElement: string;
  whPressure: string;
  // Inverters
  invPower: string;
  invPhase: string;
  invType: string;
  invMppt: string;
  invBatteryVoltage: string;
  // Batteries
  batCapacity: string;
  batVoltage: string;
  batChemistry: string;
  batMounting: string;
  // Consumables
  consSubCategory: string;
  consSize: string;
  consMaterial: string;
  consSoldBy: string;
  // Common
  brand: string;
  priceMin: string;
  priceMax: string;
}

export type SortOption = "pinned" | "price_asc" | "price_desc" | "btu_asc" | "btu_desc" | "name";

export const DEFAULT_FILTERS: CatalogFilters = {
  speedType: "__all__", unitType: "__all__", btu: "__all__", refrigerant: "__all__",
  phase: "__all__", brand: "__all__", pipeSize: "__all__",
  whCapacity: "__all__", whType: "__all__", whMounting: "__all__", whElement: "__all__", whPressure: "__all__",
  invPower: "__all__", invPhase: "__all__", invType: "__all__", invMppt: "__all__", invBatteryVoltage: "__all__",
  batCapacity: "__all__", batVoltage: "__all__", batChemistry: "__all__", batMounting: "__all__",
  consSubCategory: "__all__", consSize: "__all__", consMaterial: "__all__", consSoldBy: "__all__",
  priceMin: "", priceMax: "",
};

/** Dynamic filter counts: key → value → count */
export type DynamicFilterCounts = Record<string, Record<string, number>>;

// Keep FilterCounts for backward compat but DynamicFilterCounts is the new API
export type FilterCounts = DynamicFilterCounts;

// ── Filter label map for active pills ───────────────────
const FILTER_LABELS: Record<string, string> = {
  speedType: "Speed", unitType: "Type", btu: "BTU", refrigerant: "Refrig", phase: "Phase",
  pipeSize: "Pipe", brand: "Brand",
  whCapacity: "Capacity", whType: "Type", whMounting: "Mounting", whElement: "Element", whPressure: "Pressure",
  invPower: "Power", invPhase: "Phase", invType: "Type", invMppt: "MPPT", invBatteryVoltage: "Battery V",
  batCapacity: "Capacity", batVoltage: "Voltage", batChemistry: "Chemistry", batMounting: "Mounting",
  consSubCategory: "Sub-Cat", consSize: "Size", consMaterial: "Material", consSoldBy: "Sold By",
};

interface Props {
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
  totalCount: number;
  filteredCount: number;
  counts: DynamicFilterCounts;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  searchSuggestions?: ReactNode;
  onSearchFocus?: () => void;
  onSearchKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  viewMode: "grid" | "list" | "grouped";
  onViewModeChange: (mode: "grid" | "list" | "grouped") => void;
  productCategory?: ProductCategory;
  // Legacy props (kept for backward compat but no longer needed)
  availableBrands?: string[];
  availablePipeSizes?: string[];
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
          {opt.count !== undefined && opt.count > 0 && (
            <span className="ml-0.5 opacity-70 text-[10px]">({opt.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

function DropdownFilter({
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
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-[11px] w-44">
          <SelectValue placeholder={`All ${label}`} />
        </SelectTrigger>
        <SelectContent className="bg-popover z-50">
          <SelectItem value="__all__">All {label}</SelectItem>
          {options.filter(o => (o.count ?? 1) > 0).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label} {o.count !== undefined ? `(${o.count})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function renderFilterDimension(
  dim: FilterDimension,
  value: string,
  onChange: (v: string) => void,
  counts: Record<string, number>,
) {
  const options = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([val, count]) => ({ label: val, value: val, count }));

  if (options.length === 0) return null;

  if (dim.type === "chips") {
    return (
      <ChipGroup
        key={dim.key}
        label={dim.label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <DropdownFilter
      key={dim.key}
      label={dim.label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

const CatalogFilterBar = ({
  filters, onChange, totalCount, filteredCount, counts,
  searchQuery, onSearchChange, sortBy, onSortChange,
  searchSuggestions, onSearchFocus, onSearchKeyDown,
  viewMode, onViewModeChange, productCategory = "all",
}: Props) => {
  const [showMore, setShowMore] = useState(false);

  const set = (key: keyof CatalogFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  const dimensions = useMemo(() => getFilterConfig(productCategory), [productCategory]);
  const primaryDims = useMemo(() => dimensions.filter(d => d.row === "primary"), [dimensions]);
  const secondaryDims = useMemo(() => dimensions.filter(d => d.row === "secondary"), [dimensions]);

  // Always show price in secondary
  const showPriceFilter = true;

  const activeFilters = useMemo(() => {
    const active: { key: keyof CatalogFilters; label: string }[] = [];
    // Check all filter keys that have active dimensions
    const allDimKeys = dimensions.map(d => d.key);
    for (const dim of dimensions) {
      const k = dim.key as keyof CatalogFilters;
      const v = filters[k];
      if (v && v !== "__all__") {
        active.push({ key: k, label: `${FILTER_LABELS[k] || k}: ${v}` });
      }
    }
    if (filters.priceMin) active.push({ key: "priceMin", label: `Min: R${filters.priceMin}` });
    if (filters.priceMax) active.push({ key: "priceMax", label: `Max: R${filters.priceMax}` });
    return active;
  }, [filters, dimensions]);

  const hasActiveFilters = activeFilters.length > 0;
  const clearAll = () => onChange({ ...DEFAULT_FILTERS });
  const removeFilter = (key: keyof CatalogFilters) => {
    const defaults: Record<string, string> = { priceMin: "", priceMax: "" };
    set(key, defaults[key] ?? "__all__");
  };

  const moreFilterCount = secondaryDims
    .filter(d => filters[d.key as keyof CatalogFilters] !== "__all__")
    .length + (filters.priceMin ? 1 : 0) + (filters.priceMax ? 1 : 0);

  return (
    <div className="space-y-1.5">
      {/* ── ROW 1: Search + Primary filters + Sort ── */}
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

        {/* Primary filters */}
        <div className="space-y-1.5">
          {primaryDims.map(dim =>
            renderFilterDimension(
              dim,
              filters[dim.key as keyof CatalogFilters] || "__all__",
              (v) => set(dim.key as keyof CatalogFilters, v),
              counts[dim.key] || {},
            )
          )}
        </div>

        {/* Count + More filters toggle */}
        <div className="flex items-center justify-between pt-0.5">
          {(secondaryDims.length > 0 || showPriceFilter) ? (
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
          ) : <div />}
          <span className="text-[11px] text-muted-foreground">
            {filteredCount} of {totalCount}
          </span>
        </div>
      </div>

      {/* ── ROW 2: Expanded filters ── */}
      {showMore && (
        <div className="rounded-lg border bg-card/50 p-2.5 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
          {secondaryDims.map(dim =>
            renderFilterDimension(
              dim,
              filters[dim.key as keyof CatalogFilters] || "__all__",
              (v) => set(dim.key as keyof CatalogFilters, v),
              counts[dim.key] || {},
            )
          )}

          {/* Price range – always available */}
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
