import type { PaletteProduct } from "../QuoteBuilderTab";

/**
 * Detects whether a product is a wired remote / wired controller.
 * These should ALWAYS be priced per-unit, never per-metre.
 */
export function isWiredRemote(p: PaletteProduct): boolean {
  const blob = [p.product_code, p.short_name, p.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    (blob.includes("wired") && (blob.includes("remote") || blob.includes("controller"))) ||
    /\bbrc\d/i.test(p.product_code || "") ||
    /\bbrcw/i.test(p.product_code || "")
  );
}

/**
 * Given a Daikin AC unit's BTU, returns the product_code prefix of the
 * correct wired remote to suggest.
 *
 * - Mid-range (7 000–18 000 BTU / ~2–5 kW): BRC073
 * - Premium  (> 18 000 BTU / > 5 kW):       BRCW901A08
 * - Never suggest EKR521 / EKRS21
 */
export function getDaikinRemoteCode(btu: number): string {
  if (btu > 18000) return "BRCW901A08";
  return "BRC073";
}

/**
 * Finds the best matching wired remote product from the product list
 * for a given Daikin AC unit BTU.
 *
 * Preference:
 *  1. Stand-alone product whose code starts with the target code
 *  2. Combo product that includes the target code
 *  3. Any Daikin wired controller that is NOT EKR / EKRS
 */
export function findDaikinRemote(
  btu: number,
  allProducts: PaletteProduct[]
): PaletteProduct | null {
  const targetCode = getDaikinRemoteCode(btu);

  const daikinRemotes = allProducts.filter((p) => {
    const brand = (p.brand || "").toLowerCase();
    if (brand !== "daikin") return false;
    if (!isWiredRemote(p)) return false;
    // Exclude EKRS21 / EKR521 wire harnesses
    const code = (p.product_code || "").toUpperCase();
    if (code.startsWith("EKR")) return false;
    return true;
  });

  if (daikinRemotes.length === 0) return null;

  // 1. Exact stand-alone match (code starts with target, no '+' combos)
  const standalone = daikinRemotes.find((p) => {
    const code = (p.product_code || "").toUpperCase();
    return code.startsWith(targetCode) && !code.includes("+");
  });
  if (standalone) return standalone;

  // 2. Combo that includes the target code
  const combo = daikinRemotes.find((p) => {
    const code = (p.product_code || "").toUpperCase();
    return code.includes(targetCode);
  });
  if (combo) return combo;

  // 3. Fallback: any Daikin wired controller
  return daikinRemotes[0];
}

/**
 * Forces per-unit pricing on a product, stripping any per-metre values.
 * Returns a shallow-cloned product safe for use as an AreaMaterial / AreaConsumable.
 */
export function forcePerUnitPricing(p: PaletteProduct): PaletteProduct {
  return {
    ...p,
    sold_in_length: false,
    price_per_metre: undefined as any,
  };
}
