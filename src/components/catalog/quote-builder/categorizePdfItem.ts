/**
 * Smart item type detection for PDF catalog items.
 * Categorizes items based on keywords in name, description, and code.
 */

export type PdfItemCategory = "AC_UNIT" | "MATERIAL" | "CONSUMABLE" | "ACCESSORY" | "UNKNOWN";

const AC_KEYWORDS = /\b(BTU|INV|MW|CASS|DUCT|UC|SPLIT|MULTI|KW|INVERTER|MINI\s*WALL|UNDERCEILING|CASSETTE|DUCTED|FLOOR\s*STANDING|CEILING)\b/i;
const AC_BRANDS = /\b(DAIKIN|SAMSUNG|MIDEA|ALLIANCE|GREE|CARRIER|LG|HISENSE|BOSCH|TOSHIBA|PANASONIC|FUJITSU|MITSUBISHI|AUX)\b/i;
const MATERIAL_KEYWORDS = /\b(ALUMINIUM|COPPER|PIPE|BRACKET|CONNECTOR|TAPE|CABLE|INSULATION|TRUNK|CORE|TRUNKING|DRAIN|CONDUIT|FLARE|FITTING|CLAMP|HANGER|CHANNEL)\b/i;
const CONSUMABLE_KEYWORDS = /\b(CLEANER|PASTE|GLUE|SPRAY|SEAL|SEALANT|GAS|REFRIGERANT|NITROGEN|PUTTY|COMPOUND|FLUX|SOLDER|CLOTH|RAG)\b/i;
const ACCESSORY_KEYWORDS = /\b(REMOTE|CONTROLLER|PUMP|VALVE|FILTER|THERMOSTAT|SENSOR|CONDENSATE|TIMER|GRILLE|LOUVRE|ADAPTER)\b/i;

export function categorizePdfItem(item: {
  name?: string;
  description?: string;
  code?: string;
}): PdfItemCategory {
  const text = [item.name || "", item.description || "", item.code || ""].join(" ");

  // AC_UNIT takes priority: keyword + brand pattern, or strong AC keyword
  if (AC_KEYWORDS.test(text) && AC_BRANDS.test(text)) return "AC_UNIT";
  if (/\b\d{4,5}\s*BTU\b/i.test(text)) return "AC_UNIT";
  // Model number patterns like "9K", "12K", "18K" combined with AC brand
  if (/\b(9|12|18|24|36|48)K\b/i.test(text) && AC_BRANDS.test(text)) return "AC_UNIT";

  if (MATERIAL_KEYWORDS.test(text)) return "MATERIAL";
  if (CONSUMABLE_KEYWORDS.test(text)) return "CONSUMABLE";
  if (ACCESSORY_KEYWORDS.test(text)) return "ACCESSORY";

  // Fallback: if it has a brand pattern but no other match, assume AC_UNIT
  if (AC_BRANDS.test(text) && AC_KEYWORDS.test(text)) return "AC_UNIT";

  return "UNKNOWN";
}

/** Map category to wizard step index */
export function categoryToWizardStep(category: PdfItemCategory): number {
  switch (category) {
    case "AC_UNIT":
    case "UNKNOWN":
      return 1; // Step 2: AC Units
    case "MATERIAL":
    case "CONSUMABLE":
    case "ACCESSORY":
      return 2; // Step 3: Materials & Extras
  }
}
