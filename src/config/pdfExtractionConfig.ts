/**
 * Shared PDF extraction configuration.
 * Single source of truth for field mappings, pricing logic, and validation rules.
 * Referenced by:
 *   - supabase/functions/parse-pdf-with-grok (AI parser)
 *   - src/services/cleanImportPipeline.ts (client validation)
 *   - src/components/catalog/quote-builder/pdfAutoCatalog.ts
 */

// ─── VAT ───
export const VAT_RATE = 0.15;

// ─── Required fields the AI must return ───
export const REQUIRED_FIELDS = [
  "product_code",
  "name",
  "description",
  "cost_price",       // supplier cost (excl or incl VAT — parser detects)
  "category",
] as const;

// ─── Optional enrichment fields ───
export const OPTIONAL_FIELDS = [
  "pipe_size",
  "btu_rating",
  "refrigerant_type",
  "short_name",
  "product_category",
  "brand",
  "phase",
  "speed_type",
  "kw",
  "unit_type",
  "sold_in_length",
  "unit_length",
  "price_per_metre",
  "page_number",
  "row_bbox",
  "price_bbox",
] as const;

// ─── Valid product categories ───
export const VALID_PRODUCT_CATEGORIES = [
  "Air Conditioning",
  "Water Heaters",
  "Inverters",
  "Batteries",
  "Consumables",
] as const;

export type ProductCategory = (typeof VALID_PRODUCT_CATEGORIES)[number];

// ─── Pricing rules ───
export const PRICING_RULES = {
  /** Always store excl-VAT cost in the DB */
  excludeVat: true,
  /** Apply supplier trade discount at import time */
  applyDiscount: true,
  /** Default markup when none is set on product or company */
  defaultMarkupPercent: 20,
  /** Default supplier discount when brand_discounts has no entry */
  defaultDiscountPercent: 20,
} as const;

/** Compute our cost from supplier list price after trade discount */
export function computeOurCost(supplierCostExVat: number, discountPercent: number): number {
  return Math.round(supplierCostExVat * (1 - discountPercent / 100) * 100) / 100;
}

/** Strip VAT from an incl-VAT price */
export function stripVat(priceInclVat: number): number {
  return Math.round((priceInclVat / (1 + VAT_RATE)) * 100) / 100;
}

// ─── Validation rules ───
export const VALIDATION_RULES = {
  /** Minimum acceptable price (prevents zero/negative) */
  minPrice: 0.01,
  /** Maximum price sanity check */
  maxPrice: 1_000_000,
  /** Product code pattern — alphanumeric with dashes/slashes */
  productCodePattern: /^[A-Za-z0-9][A-Za-z0-9\-\/\s_.]{0,60}$/,
  /** Maximum description length */
  maxDescriptionLength: 500,
  /** Minimum product code length */
  minProductCodeLength: 2,
} as const;

/** Validate a single parsed product row. Returns null if valid, or error string. */
export function validateProduct(product: {
  product_code?: string;
  cost_price?: number;
  description?: string;
}): string | null {
  const code = (product.product_code || "").trim();
  if (code.length < VALIDATION_RULES.minProductCodeLength) {
    return `Product code too short: "${code}"`;
  }
  if (!VALIDATION_RULES.productCodePattern.test(code)) {
    return `Invalid product code format: "${code}"`;
  }
  const price = product.cost_price ?? 0;
  if (price < VALIDATION_RULES.minPrice) {
    return `Price too low: ${price}`;
  }
  if (price > VALIDATION_RULES.maxPrice) {
    return `Price too high: ${price}`;
  }
  if ((product.description || "").length > VALIDATION_RULES.maxDescriptionLength) {
    return "Description too long";
  }
  return null;
}

// ─── AI prompt helpers ───

/** Build the field list string for AI prompts */
export function getAiFieldList(): string {
  return [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].join(", ");
}

/** The template appended to system prompts to enforce required fields */
export const AI_FIELD_INSTRUCTION = `Each product MUST include at minimum: ${REQUIRED_FIELDS.join(", ")}. Optional enrichment fields: ${OPTIONAL_FIELDS.join(", ")}.`;

// ─── Price column selection keywords ───
export const EXCL_VAT_COLUMN_PATTERNS = [/EXCL/i, /EX\s*VAT/i, /\bCOST\b/i, /\bNET\b/i, /DEALER/i, /TRADE/i];
export const INCL_VAT_COLUMN_PATTERNS = [/INCL/i, /INC\b/i, /INCLUDING/i];

// ─── Consolidated PDF extraction config ───
export const PDF_EXTRACTION_CONFIG = {
  requiredFields: REQUIRED_FIELDS,
  optionalFields: OPTIONAL_FIELDS,
  validCategories: VALID_PRODUCT_CATEGORIES,
  pricingRules: PRICING_RULES,
  validationRules: VALIDATION_RULES,
  bboxFields: ['row_bbox', 'price_bbox', 'page_number'] as const,
} as const;
