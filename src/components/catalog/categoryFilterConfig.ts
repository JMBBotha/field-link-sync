/**
 * Category-specific filter definitions for the Product Catalog.
 * Each product category has its own set of filter dimensions,
 * derive functions, and preprocessing patterns.
 */

import type { SearchableProduct } from "./catalogSearchUtils";

// ── Types ───────────────────────────────────────────────

export type ProductCategory = "all" | "Air Conditioning" | "Water Heaters" | "Inverters" | "Batteries" | "Consumables";

export interface FilterDimension {
  key: string;
  label: string;
  /** "chips" renders inline chip buttons, "dropdown" renders a Select */
  type: "chips" | "dropdown";
  /** Whether this filter goes in the primary (always visible) or secondary (expandable) row */
  row: "primary" | "secondary";
  /** Options can be static or dynamically populated from data */
  staticOptions?: { label: string; value: string }[];
}

export interface CategoryFilterConfig {
  dimensions: FilterDimension[];
  deriveValue: (product: SearchableProduct, filterKey: string) => string;
}

// ── Derive helpers for each category ────────────────────

function textOf(p: SearchableProduct): string {
  return `${p.product_code} ${p.description} ${p.category} ${p.subcategory || ""} ${(p as any).short_name || ""}`.toLowerCase();
}

// -- Water Heaters --
function deriveWHCapacity(p: SearchableProduct): string {
  const text = textOf(p);
  const match = text.match(/\b(\d{1,3})\s*(?:l|litr)/i);
  if (match) {
    const litres = parseInt(match[1], 10);
    const buckets = [10, 15, 30, 50, 100, 150, 200, 300];
    if (litres > 300) return "300L+";
    const closest = buckets.reduce((prev, curr) => Math.abs(curr - litres) < Math.abs(prev - litres) ? curr : prev);
    return `${closest}L`;
  }
  return "";
}

function deriveWHType(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("heat pump")) return "Heat Pump";
  if (text.includes("solar") && text.includes("therm")) return "Solar Thermal";
  if (text.includes("solar")) return "Solar Thermal";
  if (text.includes("gas") || text.includes("lpg")) return "Gas";
  if (text.includes("instantaneous") || text.includes("instant") || text.includes("tankless")) return "Instantaneous";
  if (text.includes("electric") || text.includes("geyser") || text.includes("element")) return "Electric";
  return "";
}

function deriveWHMounting(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("underbasin") || text.includes("under basin") || text.includes("under-basin")) return "Underbasin";
  if (text.includes("horizontal")) return "Horizontal";
  if (text.includes("vertical")) return "Vertical";
  if (text.includes("compact")) return "Compact";
  return "";
}

function deriveWHElement(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("dual element") || text.includes("dual-element")) return "Dual";
  const match = text.match(/\b([2-4])\s*kw\b/i);
  if (match) return `${match[1]}kW`;
  return "";
}

function deriveWHPressure(p: SearchableProduct): string {
  const text = textOf(p);
  const match = text.match(/\b(400|600)\s*kpa\b/i);
  if (match) return `${match[1]}kPa`;
  if (text.includes("high pressure") || text.includes("high-pressure")) return "High Pressure";
  return "";
}

// -- Inverters (Solar) --
function deriveInvPower(p: SearchableProduct): string {
  const text = textOf(p);
  const match = text.match(/\b(\d{1,2}(?:\.\d)?)\s*kw\b/i);
  if (match) {
    const kw = parseFloat(match[1]);
    const buckets = [3, 5, 6, 8, 10, 12, 15, 20];
    if (kw > 20) return "20kW+";
    const closest = buckets.reduce((prev, curr) => Math.abs(curr - kw) < Math.abs(prev - kw) ? curr : prev);
    return `${closest}kW`;
  }
  return "";
}

function deriveInvPhase(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("three phase") || text.includes("3-phase") || text.includes("3ph")) return "Three Phase";
  if (text.includes("single phase") || text.includes("1-phase") || text.includes("1ph")) return "Single Phase";
  return "";
}

function deriveInvType(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("hybrid")) return "Hybrid";
  if (text.includes("off-grid") || text.includes("off grid")) return "Off-Grid";
  if (text.includes("grid-tie") || text.includes("grid tie") || text.includes("grid tied")) return "Grid-Tie";
  return "";
}

function deriveInvMppt(p: SearchableProduct): string {
  const text = textOf(p);
  const match = text.match(/\b(\d)\s*mppt\b/i);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 3) return "3+";
    return `${n}`;
  }
  return "";
}

function deriveInvBatteryVoltage(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("high voltage") || text.includes("hv")) return "High Voltage";
  const match = text.match(/\b(24|48)\s*v\b/i);
  if (match) return `${match[1]}V`;
  return "";
}

// -- Batteries --
function deriveBatCapacity(p: SearchableProduct): string {
  const text = textOf(p);
  const match = text.match(/\b(\d{1,3}(?:\.\d)?)\s*kwh\b/i);
  if (match) {
    const kwh = parseFloat(match[1]);
    const buckets = [5, 10, 14, 20];
    if (kwh > 20) return "20kWh+";
    const closest = buckets.reduce((prev, curr) => Math.abs(curr - kwh) < Math.abs(prev - kwh) ? curr : prev);
    return `${closest}kWh`;
  }
  return "";
}

function deriveBatVoltage(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("51.2v") || text.includes("51.2 v")) return "51.2V";
  const match = text.match(/\b(12|24|48)\s*v\b/i);
  if (match) return `${match[1]}V`;
  return "";
}

function deriveBatChemistry(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("lifepo4") || text.includes("lithium") || text.includes("lfp")) return "LiFePO4";
  if (text.includes("lead-acid") || text.includes("lead acid") || text.includes("agm") || text.includes("gel")) return "Lead-Acid";
  return "";
}

function deriveBatMounting(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("wall mount") || text.includes("wall-mount")) return "Wall Mount";
  if (text.includes("rack")) return "Rack";
  if (text.includes("floor")) return "Floor";
  return "";
}

// -- Consumables --
function deriveConsSubCategory(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("copper pipe") || text.includes("copper tube")) return "Copper Pipe";
  if (text.includes("insulation") || text.includes("armaflex") || text.includes("foam")) return "Insulation";
  if (text.includes("cable") || text.includes("wire")) return "Cable";
  if (text.includes("trunking") || text.includes("duct cover")) return "Trunking";
  if (text.includes("fitting") || text.includes("coupling") || text.includes("elbow") || text.includes("tee ")) return "Fittings";
  if (text.includes("tape") || text.includes("pvc tape")) return "Tape";
  if (text.includes("bracket") || text.includes("mount")) return "Brackets";
  if (text.includes("drain") || text.includes("condensate")) return "Drainage";
  return p.subcategory || "";
}

function deriveConsSize(p: SearchableProduct): string {
  const text = textOf(p);
  // Match mm sizes like "6.35mm" or "1/4 inch" or "15mm"
  const mmMatch = text.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mmMatch) return `${mmMatch[1]}mm`;
  const inchMatch = text.match(/\b(\d\/\d)\s*(?:inch|")\b/i);
  if (inchMatch) return inchMatch[1];
  return "";
}

function deriveConsMaterial(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("copper")) return "Copper";
  if (text.includes("pvc")) return "PVC";
  if (text.includes("foam") || text.includes("rubber")) return "Foam";
  if (text.includes("galvanised") || text.includes("galvanized") || text.includes("steel")) return "Galvanised";
  return "";
}

function deriveConsSoldBy(p: SearchableProduct): string {
  const text = textOf(p);
  if (text.includes("per metre") || text.includes("per meter") || text.includes("/m") || text.includes("p/m")) return "Per metre";
  if (text.includes("per roll") || text.includes("roll")) return "Per roll";
  if (text.includes("per kit") || text.includes("kit")) return "Per kit";
  if (text.includes("each") || text.includes("per unit")) return "Each";
  return "";
}

// ── Category filter configurations ──────────────────────

const AC_FILTERS: FilterDimension[] = [
  { key: "speedType", label: "Speed", type: "chips", row: "primary" },
  { key: "btu", label: "BTU", type: "dropdown", row: "primary" },
  { key: "refrigerant", label: "Refrig.", type: "chips", row: "primary" },
  { key: "unitType", label: "Type", type: "dropdown", row: "secondary" },
  { key: "phase", label: "Phase", type: "chips", row: "secondary" },
  { key: "brand", label: "Brand", type: "chips", row: "secondary" },
  { key: "pipeSize", label: "Pipe", type: "dropdown", row: "secondary" },
];

const WH_FILTERS: FilterDimension[] = [
  { key: "whType", label: "Type", type: "chips", row: "primary" },
  { key: "whCapacity", label: "Capacity", type: "dropdown", row: "primary" },
  { key: "whMounting", label: "Mounting", type: "chips", row: "primary" },
  { key: "whElement", label: "Element", type: "chips", row: "secondary" },
  { key: "whPressure", label: "Pressure", type: "chips", row: "secondary" },
  { key: "brand", label: "Brand", type: "chips", row: "secondary" },
];

const INV_FILTERS: FilterDimension[] = [
  { key: "invType", label: "Type", type: "chips", row: "primary" },
  { key: "invPower", label: "Power", type: "dropdown", row: "primary" },
  { key: "invPhase", label: "Phase", type: "chips", row: "primary" },
  { key: "invMppt", label: "MPPT", type: "chips", row: "secondary" },
  { key: "invBatteryVoltage", label: "Battery V", type: "chips", row: "secondary" },
  { key: "brand", label: "Brand", type: "chips", row: "secondary" },
];

const BAT_FILTERS: FilterDimension[] = [
  { key: "batChemistry", label: "Chemistry", type: "chips", row: "primary" },
  { key: "batCapacity", label: "Capacity", type: "dropdown", row: "primary" },
  { key: "batVoltage", label: "Voltage", type: "chips", row: "primary" },
  { key: "batMounting", label: "Mounting", type: "chips", row: "secondary" },
  { key: "brand", label: "Brand", type: "chips", row: "secondary" },
];

const CONS_FILTERS: FilterDimension[] = [
  { key: "consSubCategory", label: "Sub-Cat", type: "dropdown", row: "primary" },
  { key: "consMaterial", label: "Material", type: "chips", row: "primary" },
  { key: "consSoldBy", label: "Sold By", type: "chips", row: "primary" },
  { key: "consSize", label: "Size", type: "dropdown", row: "secondary" },
  { key: "brand", label: "Brand", type: "chips", row: "secondary" },
];

const ALL_FILTERS: FilterDimension[] = [
  { key: "brand", label: "Brand", type: "chips", row: "primary" },
];

// ── Main API ────────────────────────────────────────────

export function getFilterConfig(category: ProductCategory): FilterDimension[] {
  switch (category) {
    case "Air Conditioning": return AC_FILTERS;
    case "Water Heaters": return WH_FILTERS;
    case "Inverters": return INV_FILTERS;
    case "Batteries": return BAT_FILTERS;
    case "Consumables": return CONS_FILTERS;
    case "all":
    default: return ALL_FILTERS;
  }
}

/** Get all possible filter keys across all categories */
export function getAllFilterKeys(): string[] {
  return [
    // AC
    "speedType", "unitType", "btu", "refrigerant", "phase", "pipeSize",
    // Water Heaters
    "whCapacity", "whType", "whMounting", "whElement", "whPressure",
    // Inverters
    "invPower", "invPhase", "invType", "invMppt", "invBatteryVoltage",
    // Batteries
    "batCapacity", "batVoltage", "batChemistry", "batMounting",
    // Consumables
    "consSubCategory", "consSize", "consMaterial", "consSoldBy",
    // Common
    "brand", "priceMin", "priceMax",
  ];
}

/** Derive filter value for any filter key from any product */
export function deriveCategoryFilterValue(p: SearchableProduct, filterKey: string): string {
  // Import AC derives from catalogSearchUtils at call site to avoid circular deps
  switch (filterKey) {
    // Water Heaters
    case "whCapacity": return deriveWHCapacity(p);
    case "whType": return deriveWHType(p);
    case "whMounting": return deriveWHMounting(p);
    case "whElement": return deriveWHElement(p);
    case "whPressure": return deriveWHPressure(p);
    // Inverters
    case "invPower": return deriveInvPower(p);
    case "invPhase": return deriveInvPhase(p);
    case "invType": return deriveInvType(p);
    case "invMppt": return deriveInvMppt(p);
    case "invBatteryVoltage": return deriveInvBatteryVoltage(p);
    // Batteries
    case "batCapacity": return deriveBatCapacity(p);
    case "batVoltage": return deriveBatVoltage(p);
    case "batChemistry": return deriveBatChemistry(p);
    case "batMounting": return deriveBatMounting(p);
    // Consumables
    case "consSubCategory": return deriveConsSubCategory(p);
    case "consSize": return deriveConsSize(p);
    case "consMaterial": return deriveConsMaterial(p);
    case "consSoldBy": return deriveConsSoldBy(p);
    default: return "";
  }
}

// ── Category-specific search preprocessing patterns ─────

export interface CategoryPreprocessPattern {
  pattern: RegExp;
  filterKey: string;
  value: string;
}

export function getCategoryPreprocessPatterns(category: ProductCategory): CategoryPreprocessPattern[] {
  const patterns: CategoryPreprocessPattern[] = [];

  if (category === "Water Heaters" || category === "all") {
    patterns.push(
      { pattern: /\bgeyser\b/gi, filterKey: "whType", value: "Electric" },
      { pattern: /\bheat\s*pump\b/gi, filterKey: "whType", value: "Heat Pump" },
      { pattern: /\bsolar\b/gi, filterKey: "whType", value: "Solar Thermal" },
      { pattern: /\bgas\b/gi, filterKey: "whType", value: "Gas" },
      { pattern: /\binstant(?:aneous)?\b/gi, filterKey: "whType", value: "Instantaneous" },
      { pattern: /\b(\d{2,3})\s*l(?:itre)?s?\b/gi, filterKey: "whCapacity", value: "$1L" },
      { pattern: /\bunderbasin\b/gi, filterKey: "whMounting", value: "Underbasin" },
      { pattern: /\bhorizontal\b/gi, filterKey: "whMounting", value: "Horizontal" },
    );
  }

  if (category === "Inverters" || category === "all") {
    patterns.push(
      { pattern: /\bhybrid\b/gi, filterKey: "invType", value: "Hybrid" },
      { pattern: /\bgrid[- ]?tie\b/gi, filterKey: "invType", value: "Grid-Tie" },
      { pattern: /\boff[- ]?grid\b/gi, filterKey: "invType", value: "Off-Grid" },
      { pattern: /\b(\d{1,2})\s*kw\b/gi, filterKey: "invPower", value: "$1kW" },
    );
  }

  if (category === "Batteries" || category === "all") {
    patterns.push(
      { pattern: /\blithium\b/gi, filterKey: "batChemistry", value: "LiFePO4" },
      { pattern: /\blifepo4\b/gi, filterKey: "batChemistry", value: "LiFePO4" },
      { pattern: /\blead[- ]?acid\b/gi, filterKey: "batChemistry", value: "Lead-Acid" },
      { pattern: /\b(\d{1,3})\s*kwh\b/gi, filterKey: "batCapacity", value: "$1kWh" },
      { pattern: /\bwall\s*mount\b/gi, filterKey: "batMounting", value: "Wall Mount" },
    );
  }

  if (category === "Consumables" || category === "all") {
    patterns.push(
      { pattern: /\bcopper\s*pipe\b/gi, filterKey: "consSubCategory", value: "Copper Pipe" },
      { pattern: /\binsulation\b/gi, filterKey: "consSubCategory", value: "Insulation" },
      { pattern: /\btrunking\b/gi, filterKey: "consSubCategory", value: "Trunking" },
      { pattern: /\b(\d+(?:\.\d+)?)\s*mm\b/gi, filterKey: "consSize", value: "$1mm" },
    );
  }

  return patterns;
}
