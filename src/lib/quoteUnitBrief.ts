// Short per-quote unit summary for the quotes list (Johan 27 Oct 11:24), e.g. "Samsung · 9k + 12k · 3 units".
// Same unit/brand/BTU rules as the SQL quote_auto_summary (20261013150000), read-only from quote_items.
export type BriefLine = { quote_id?: string; item_name?: string | null; item_type?: string | null; quantity?: unknown; parent_item_id?: string | null; metadata?: { brand?: string; capacity_btu?: number | string; is_unit?: boolean | string } | null };

const BRANDS = /\b(samsung|daikin|midea|lg|mitsubishi|carrier|alliance|gree|hisense|toshiba|panasonic|fujitsu|comfee|comfy|aux|tcl|york|sinclair|tecnosystemi)\b/i;
const NOT_UNIT = /install|material|kit|labour|pipe|bracket|regas/i;
const BTU_NAME = /\b\d{1,2}\s*k(\s*btu)?\b|\d{4,5}\s*btu/i;

const brandOf = (l: BriefLine) => {
  const raw = String(l.metadata?.brand || "").trim() || (String(l.item_name || "").match(BRANDS)?.[1] ?? "");
  if (!raw) return null;
  const b = raw.toLowerCase();
  if (b === "lg") return "LG";
  if (b === "comfy") return "Comfee";
  return b.charAt(0).toUpperCase() + b.slice(1);
};
const btuOf = (l: BriefLine) => {
  const cap = String(l.metadata?.capacity_btu ?? "");
  if (/^\d+$/.test(cap)) return Math.round(Number(cap) / 1000);
  const n = String(l.item_name || "");
  const k = n.match(/\b(\d{1,2})\s*k(\s*btu)?\b/i);
  if (k) return Number(k[1]);
  const b = n.match(/(\d{4,5})\s*BTU/i);
  return b ? Math.round(Number(b[1]) / 1000) : null;
};
export const isUnitLine = (l: BriefLine) =>
  !l.parent_item_id && Number(l.quantity) > 0 &&
  !["labour", "service", "material", "materials"].includes(String(l.item_type || "").toLowerCase()) &&
  (l.metadata?.is_unit === true || l.metadata?.is_unit === "true" || (BTU_NAME.test(String(l.item_name || "")) && !NOT_UNIT.test(String(l.item_name || ""))));

/** "Samsung · 9k + 12k · 3 units"; null when the quote has no recognisable units. */
export function quoteUnitBrief(lines: BriefLine[]): string | null {
  const units = lines.filter(isUnitLine);
  if (!units.length) return null;
  const n = units.reduce((s, l) => s + Number(l.quantity), 0);
  const brands = [...new Set(units.map(brandOf).filter(Boolean))] as string[];
  const sizes = [...new Set(units.map(btuOf).filter((x): x is number => x != null))].sort((a, b) => a - b);
  const parts = [
    brands.length > 2 ? `${brands.slice(0, 2).join(", ")} +${brands.length - 2}` : brands.join(", "),
    sizes.length > 3 ? `${sizes[0]}k–${sizes[sizes.length - 1]}k` : sizes.map((s) => `${s}k`).join(" + "),
    `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "unit" : "units"}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
