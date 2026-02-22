import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Categories that are legitimately sold per-meter.
 * Everything else must be forced to per-unit.
 */
const PER_METER_KEYWORDS = [
  "copper pipe", "copper tube",
  "drain pipe", "drain hose", "drain line",
  "trunking", "trunk",
  "electrical cable", "cable", "twin & earth", "surfix",
  "interconnect", "intercon",
];

const FORCE_PER_UNIT_KEYWORDS = [
  "bracket", "remote", "tape", "fitting", "insulation",
  "sleeve", "strap", "clamp", "saddle", "hanger",
  "hook", "valve", "filter", "flare nut", "elbow",
  "coupling", "reducer", "adaptor", "adapter", "connector",
  "plug", "gland", "shrink", "tie", "cleaner", "paste",
  "gas", "glue", "spray", "seal", "solder", "adhesive",
  "capacitor", "contactor", "thermostat", "pump",
  "brc", "ekr", "brcw",
];

/**
 * Determine whether a product should be priced per-meter or per-unit.
 * Returns "per-meter" only for copper pipe, drain pipe, trunking, electrical cable.
 * Everything else returns "per-unit".
 */
export function determinePricingMode(product: PaletteProduct): "per-meter" | "per-unit" {
  const blob = [
    product.short_name,
    product.product_code,
    product.description,
    product.product_category,
    product.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Check if it matches a forced per-unit keyword first (higher priority)
  for (const kw of FORCE_PER_UNIT_KEYWORDS) {
    if (blob.includes(kw)) {
      // Exception: "copper pipe" contains "pipe" but should be per-meter
      // So only force per-unit if it does NOT also match a per-meter keyword
      const alsoPerMeter = PER_METER_KEYWORDS.some((pm) => blob.includes(pm));
      if (!alsoPerMeter) {
        return "per-unit";
      }
    }
  }

  // Check if it legitimately matches per-meter categories
  const hasPerMeterPrice =
    product.sold_in_length &&
    typeof product.price_per_metre === "number" &&
    product.price_per_metre > 0;

  if (hasPerMeterPrice) {
    for (const kw of PER_METER_KEYWORDS) {
      if (blob.includes(kw)) return "per-meter";
    }
  }

  // Also respect DB pricing_mode if set
  const dbMode = (product as any).pricing_mode;
  if (dbMode === "per-meter" && hasPerMeterPrice) {
    return "per-meter";
  }

  return "per-unit";
}

/**
 * Audit a product's pricing mode and warn if mismatched.
 * Call during dev to catch incorrect configurations.
 */
export function auditPricingMode(product: PaletteProduct, appliedMode: "length" | "unit"): void {
  if (process.env.NODE_ENV === "production") return;

  const correctMode = determinePricingMode(product);
  const appliedModeNorm = appliedMode === "length" ? "per-meter" : "per-unit";

  if (correctMode !== appliedModeNorm) {
    console.warn(
      `[PricingMode MISMATCH] Product "${product.short_name || product.product_code}" ` +
      `(id: ${product.id}) has applied mode "${appliedModeNorm}" but should be "${correctMode}". ` +
      `sold_in_length=${product.sold_in_length}, price_per_metre=${product.price_per_metre}`
    );
  }
}

/**
 * Convert determinePricingMode result to AreaMaterial pricingMode value.
 */
export function toAreaPricingMode(mode: "per-meter" | "per-unit"): "length" | "unit" {
  return mode === "per-meter" ? "length" : "unit";
}
