/**
 * Edge copy of the unit-line rule in src/lib/lineDisplay.ts (isAcUnitLine and
 * the helpers it calls). Supabase cannot import src/. send-quote-email uses
 * this so a unit with no photo is still blocked the same way. The boundary
 * test checks this copy agrees with the app.
 */

const INSTALL_MATERIAL_NAME_RE = /copper|arma ?flex|insulation|lasso|cable tie|trunking|end cap|bracket|flatback|docking channel|pvc pipe|pvc elbow|drain|piping kit/i;
const AC_CATEGORY_RE = /air ?con|midwall|mid-wall|wall ?mount|inverter|split|cassette|ducted|floor ?ceiling|indoor|outdoor|multi ?split|\bvrf\b|\bvrv\b|\bunits?\b/i;
const NON_AC_CATEGORY_RE = /control|remote|consumable|accessor|material|copper|pipe|piping|insulation|trunking|bracket|drain|electrical|cable|tool|refrigerant gas|service|labour|kit\b|spare/i;
const AC_SIZE_RE = /\b\d{1,2}\s?K\b|\b\d{4,5}\s?BTU\b/i;
const AC_WORD_RE = /\b(INV|inverter|MW|midwall|split|cassette|ducted|floor|ceiling|portable|non-inv)\b/i;
const AC_BRAND_RE = /\b(Samsung|LG|Midea|Daikin|Carrier|Gree|Alliance|Hisense|Mitsubishi|Toshiba|Panasonic|Fujitsu|York|Chigo|TCL|Aux)\b/i;
/** Fallback only: indoor/outdoor model codes of common brands, e.g. Samsung AR24BSAAAWK/FA, Midea MSAG-12HRN1, Daikin FTXM35, LG S12EQ. */
const AC_MODEL_CODE_RE = new RegExp([
  String.raw`\bA[RCJ]\d{2}[A-Z]{2,}`,                      // Samsung AR24BSAAAWK, AC071 cassette, AJ multi
  String.raw`\bM(?:SAG|SAF|SMB|SEB|SVP|SXP|SA[A-Z]?|OX|OB|OU|CD|TI|DV)[A-Z0-9-]*\d{2}`, // Midea MSAG-12HRN1, MOX..., MCD cassette
  String.raw`\b(?:FTX|FTK|ATX|FCA|FCQ|FBA|FHA|RXM|RXF|RZA|RXS|RKS)[A-Z]*\d{2}`, // Daikin
  String.raw`\b(?:MSZ|MUZ|MSY|MUY|SRK|SRC|PLA|PKA)-?[A-Z]*\d{2}`, // Mitsubishi
  String.raw`\bGW[HC]\d{2}`,                                // Gree
  String.raw`\b(?:S\d{2}[A-Z]{2,}|S4-[A-Z]?\d{2}|[A-Z]?S-?[QH]\d{2}[A-Z]{2})`, // LG S12EQ, S4-Q12
  String.raw`\bC[SU]-[A-Z]*\d{2}`,                          // Panasonic CS-/CU-
  String.raw`\bA[SO][YU]G\d{2}`,                          // Fujitsu ASYG12 / AOYG12
  String.raw`\b(?:42|38)[A-Z]{3}\d{2,3}`,                   // Carrier 42QHC012
].join("|"), "i");

export interface AcUnitLineInput {
  item_name?: string | null;
  item_type?: string | null;
  is_bundle?: boolean | null;
  metadata?: any;
  isLabour?: boolean;
}
export interface AcUnitProductInput {
  product_category?: string | null;
  category?: string | null;
  subcategory?: string | null;
  product_type?: string | null;
  unit_type?: string | null;
  capacity_btu?: number | null;
  btu_rating?: number | null;
  kw?: number | null;
  is_unit?: boolean | null;
}

/** Product data says this is an AC unit (catalogue type/category/capacity). null = product data cannot tell. */
export function acUnitFromProduct(product?: AcUnitProductInput | null): boolean | null {
  if (!product) return null;
  const cat = [product.product_category, product.category, product.subcategory, product.product_type, product.unit_type].filter(Boolean).join(" ");
  if (product.is_unit === true) return true;
  if (product.is_unit === false) return false;
  if (cat && NON_AC_CATEGORY_RE.test(cat) && !/air ?con/i.test(cat)) return false;
  if (cat && AC_CATEGORY_RE.test(cat)) return true;
  const btu = Number(product.capacity_btu ?? product.btu_rating) || 0;
  const kw = Number(product.kw) || 0;
  if (btu >= 5000 || kw >= 1.5) return true;
  return null;
}

/** Line looks like a model-code-only AC unit, e.g. "AR24BSAAAWK/FA". Fallback when no product data. */
export function looksLikeAcModelCode(name: string): boolean {
  return AC_MODEL_CODE_RE.test(String(name || ""));
}

/** Display-only: is this quote line an AC unit (install materials group under it)? */
export function isAcUnitLine(item: AcUnitLineInput, product?: AcUnitProductInput | null): boolean {
  const md = item.metadata || {};
  const type = String(item.item_type || "").trim();
  const name = String(item.item_name || "");
  if (item.is_bundle || md.kit || md.install || md.labour || md.catalog_service_id || item.isLabour) return false;
  if (/^(installation kit|consumables|service|labour)$/i.test(type)) return false;
  if (INSTALL_MATERIAL_NAME_RE.test(name)) return false;
  if (/\b(remote|controller|dongle|harness|purifier)\b/i.test(name) || /control/i.test(String(product?.category || product?.subcategory || ""))) return false;
  if (/air ?con/i.test(type)) return true;
  // Product data first (catalogue row, or the copy stamped on the line), the name only as a fallback.
  if (md.is_unit === true || md.ac_unit === true) return true;
  const fromProduct = acUnitFromProduct(product) ?? acUnitFromProduct(md.product ?? (md.capacity_btu || md.btu || md.product_category ? { capacity_btu: md.capacity_btu ?? md.btu, product_category: md.product_category, category: md.category } : null));
  if (fromProduct !== null) return fromProduct;
  if (AC_SIZE_RE.test(name) && (AC_WORD_RE.test(name) || AC_BRAND_RE.test(name))) return true;
  return looksLikeAcModelCode(name);
}
