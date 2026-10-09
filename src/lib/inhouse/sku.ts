/**
 * Internal SKUs — our own stable product-type codes (2026-10-09).
 *
 * Format: FAMILY-TYPE[-SIZE][-VARIANT]
 *   - segments joined by "-", each segment only [A-Z0-9._] (uppercase, URL-safe)
 *   - fractions: "/" -> "_"  (1/4" copper -> CU-SD-1_4)
 *   - decimals keep ".", "," becomes "."   (2,5 mm cable -> 2.5)
 *   - a trailing "MM" on a size is dropped (25mm conduit -> ELC-CON-25), other units (M, IN, X) stay
 *   - clash -> "-2", "-3" ... suffix (shown to the user, never silent)
 * Examples: ELC-CAB-2.5-3C, ELC-CON-25, CU-SD-1_4, FIX-BOLT-M10X50, CSM-TAPE-PVC-BLK.
 * In-house items have no supplier code: the SKU is also their product_code.
 */

export const SKU_PATTERN = /^[A-Z0-9]+(-[A-Z0-9._]+)*$/;
export const SKU_MAX = 48;

export type SkuUnit = "each" | "metre";

export interface SkuType { code: string; label: string; unit: SkuUnit; sizeHint?: string; variantHint?: string }
export interface InhouseCategory { label: string; family: string; types: SkuType[] }

/** The One Stop Shop in-house categories (Johan, 2026-10-09) and their SKU family/type codes. */
export const INHOUSE_CATEGORIES: InhouseCategory[] = [
  {
    label: "Electrical cable", family: "ELC", types: [
      { code: "CAB", label: "Surfix / flat cable", unit: "metre", sizeHint: "mm², e.g. 2.5", variantHint: "cores, e.g. 3C" },
      { code: "CABF", label: "Flex cable", unit: "metre", sizeHint: "mm², e.g. 1.5", variantHint: "cores, e.g. 3C" },
      { code: "CABE", label: "Earth wire", unit: "metre", sizeHint: "mm², e.g. 4" },
      { code: "CABS", label: "SWA armoured cable", unit: "metre", sizeHint: "mm², e.g. 6", variantHint: "cores, e.g. 4C" },
    ],
  },
  {
    label: "Electrical conduit", family: "ELC", types: [
      { code: "CON", label: "PVC conduit", unit: "metre", sizeHint: "mm, e.g. 25" },
      { code: "CONF", label: "Flexible conduit", unit: "metre", sizeHint: "mm, e.g. 20" },
      { code: "CONB", label: "Conduit bend / coupler", unit: "each", sizeHint: "mm, e.g. 25", variantHint: "e.g. BEND, COUP" },
      { code: "ISO", label: "Isolator", unit: "each", sizeHint: "amps, e.g. 32A", variantHint: "e.g. IP65" },
    ],
  },
  {
    label: "Consumables", family: "CSM", types: [
      { code: "TAPE", label: "Tape", unit: "each", sizeHint: "e.g. 50MM", variantHint: "e.g. PVC-BLK" },
      { code: "SIL", label: "Silicone / sealant", unit: "each", sizeHint: "e.g. 280ML" },
      { code: "TIE", label: "Cable ties", unit: "each", sizeHint: "e.g. 300X4.8", variantHint: "e.g. P100" },
      { code: "GEN", label: "Other consumable", unit: "each" },
    ],
  },
  {
    label: "Bolts & nuts", family: "FIX", types: [
      { code: "BOLT", label: "Bolt", unit: "each", sizeHint: "e.g. M10X50", variantHint: "e.g. GALV" },
      { code: "NUT", label: "Nut", unit: "each", sizeHint: "e.g. M10" },
      { code: "WASH", label: "Washer", unit: "each", sizeHint: "e.g. M10" },
      { code: "ANCH", label: "Anchor / rawl bolt", unit: "each", sizeHint: "e.g. M10X75" },
      { code: "SCR", label: "Screw", unit: "each", sizeHint: "e.g. 8GX40" },
      { code: "ROD", label: "Threaded rod", unit: "each", sizeHint: "e.g. M10X1M" },
    ],
  },
];

export const INHOUSE_CATEGORY_LABELS = INHOUSE_CATEGORIES.map((c) => c.label);

export function categoryByLabel(label: string | null | undefined): InhouseCategory | undefined {
  return INHOUSE_CATEGORIES.find((c) => c.label === label);
}

/** One SKU segment: uppercase, "/"->"_", ","->".", spaces/other chars dropped. */
export function skuSegment(raw: string | null | undefined, opts: { dropMm?: boolean } = {}): string {
  let s = String(raw ?? "").trim().toUpperCase();
  s = s.replace(/["”″]/g, "IN").replace(/[’']/g, "");
  s = s.replace(/\//g, "_").replace(/,/g, ".").replace(/×/g, "X");
  s = s.replace(/[\s-]+/g, "").replace(/[^A-Z0-9._]/g, "");
  if (opts.dropMm) s = s.replace(/(\d)MM²?$/, "$1").replace(/(\d)MM2$/, "$1");
  s = s.replace(/^[._]+|[._]+$/g, "");
  return s;
}

export interface SkuParts { family: string; type: string; size?: string | null; variant?: string | null }

/** Build FAMILY-TYPE[-SIZE][-VARIANT]; empty optional parts are skipped. */
export function buildSku(p: SkuParts): string {
  const segs = [skuSegment(p.family), skuSegment(p.type), skuSegment(p.size, { dropMm: true }), skuSegment(p.variant)].filter(Boolean);
  return segs.join("-").slice(0, SKU_MAX);
}

export function isValidSku(code: string): boolean {
  return !!code && code.length <= SKU_MAX && SKU_PATTERN.test(code);
}

/**
 * First free code: base, then base-2, base-3 ... `taken` holds codes already used
 * (other SKUs and every product_code of the supplier, archived included — the DB
 * keeps (supplier_id, product_code) unique). `own` = the item's current code (editing keeps it).
 */
export function nextFreeSku(base: string, taken: Iterable<string>, own?: string | null): { code: string; clashed: boolean } {
  const set = new Set([...taken].map((c) => String(c || "").toUpperCase()));
  if (own) set.delete(own.toUpperCase());
  if (!set.has(base)) return { code: base, clashed: false };
  for (let n = 2; n < 1000; n++) {
    const c = `${base}-${n}`;
    if (!set.has(c)) return { code: c, clashed: true };
  }
  throw new Error(`No free SKU for ${base}`);
}

/** Suggested display name from the picked parts, e.g. "Surfix / flat cable 2.5mm² 3C". */
export function suggestName(cat: InhouseCategory | undefined, type: SkuType | undefined, size?: string | null, variant?: string | null): string {
  if (!type) return "";
  const sz = String(size || "").trim();
  const unitSuffix = sz && /^\d+(\.\d+)?$/.test(sz.replace(",", ".")) && cat?.label === "Electrical cable" ? "mm²"
    : sz && /^\d+(\.\d+)?$/.test(sz.replace(",", ".")) && /conduit/i.test(cat?.label || "") && type.code.startsWith("CON") ? "mm" : "";
  return [type.label, sz ? `${sz}${unitSuffix}` : "", String(variant || "").trim()].filter(Boolean).join(" ");
}
