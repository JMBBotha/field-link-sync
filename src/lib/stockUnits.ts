/**
 * Stock units for consumables. Every stock item is counted in ONE stock unit (each, m, kg, l, roll).
 * When the supplier sells a pack that we use by length/weight/volume (a 15 m copper coil, an 11.3 kg
 * gas cylinder, a 5 L can), pack_size says how many stock units one purchased pack holds.
 *   received stock = packs × pack_size        cost per stock unit = pack cost ÷ pack_size
 */
export type StockUnit = "each" | "m" | "kg" | "l" | "roll";
export type StockKind = "consumable" | "tool" | "labour";

export interface CatalogueProduct {
  product_code?: string | null;
  short_name?: string | null;
  name?: string | null;
  description?: string | null;
  price_per_unit_label?: string | null;
  sold_in_length?: boolean | null;
  unit_length?: number | string | null;
}

export interface UnitMapping {
  stock_unit: StockUnit;
  /** stock units in one purchased pack (1 when sold per stock unit) */
  pack_size: number;
  /** what the supplier sells: coil, cylinder, can, length, box, roll, bottle… or "each" */
  pack_label: string;
  kind: StockKind;
  /** false = rule guessed, a person should check */
  sure: boolean;
  reason: string;
}

const num = (s: string) => Number(s.replace(",", "."));
const textOf = (p: CatalogueProduct) =>
  [p.short_name, p.name, p.description].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const TOOL_RE =
  /\b(drill bit|pipe cutter|mini pipe cutter|side\/diagonal|hacksaw - aluminium|hammer|allen key|manifold|measuring tape|pliers|spanner|socket|screwdriver|rachet|ratchet|extension bar|spirit level|torch|vacuum pump|charging scale|charging hose|multimeter|thermometer|flaring|swag+ing|spring bender|comb coil|sds plus|core bit|can tap|fin straightener)\b/i;
const REFRIGERANT_RE = /\b(r-?(?:22|32|134a|290|404a?|407c?|410a?|507a?|600a))\b/i;
const NOT_GAS_RE = /\b(dryer|compressor|manifold|charging|can tap|pcb|tubing)\b/i;

const m = (pack_size: number, pack_label: string, reason: string, sure = true): UnitMapping =>
  ({ stock_unit: "m", pack_size, pack_label, kind: "consumable", sure, reason });
const each = (reason: string, sure = true, kind: StockKind = "consumable", pack_size = 1, pack_label = "each"): UnitMapping =>
  ({ stock_unit: "each", pack_size, pack_label, kind, sure, reason });

export function stockUnitFor(p: CatalogueProduct): UnitMapping {
  const t = textOf(p);
  const code = (p.product_code ?? "").toUpperCase();
  const lbl = (p.price_per_unit_label ?? "").trim().toLowerCase();
  const ul = p.unit_length == null ? NaN : Number(p.unit_length);

  if (/^(STD-|ELEC-)/.test(code) || /\b(installation|allowance)\b/i.test(t))
    return each("labour / install price, not stock", true, "labour");

  // Refrigerant: drawn per kg from a cylinder or can
  if (REFRIGERANT_RE.test(t) && !NOT_GAS_RE.test(t)) {
    const w = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
    if (w) {
      const kg = w[2].toLowerCase() === "g" ? num(w[1]) / 1000 : num(w[1]);
      const label = /\bcan\b/i.test(t) ? "can" : "cylinder";
      return { stock_unit: "kg", pack_size: kg, pack_label: label, kind: "consumable", sure: true, reason: `refrigerant ${kg} kg ${label}` };
    }
    return { stock_unit: "kg", pack_size: 1, pack_label: "cylinder", kind: "consumable", sure: false, reason: "refrigerant, cylinder size not in name" };
  }
  if (/mapp gas/i.test(t) && !/torch/i.test(t)) return each("MAPP brazing gas: counted per can", false, "consumable", 1, "can");

  if (TOOL_RE.test(t) && !/hacksaw - bi-metal blade/i.test(t)) return each("tool (not drawn onto jobs)", true, "tool");

  if (/\b(controller|remote|panel|dongle|kit -|pcb)\b/i.test(t) && !/copper kit/i.test(t)) return each("part, counted each");

  // Catalogue already sells it per metre
  if (lbl === "m" || lbl === "metre" || lbl === "meter") {
    const size = Number.isFinite(ul) && ul > 0 ? ul : 1;
    return m(size, size === 1 ? "metre" : packLabelFor(t), `catalogue priced per metre, ${size} m per ${size === 1 ? "metre" : packLabelFor(t)}`);
  }
  if (/per\s*met(?:er|re)/i.test(t)) return m(1, "metre", "sold per metre");

  if (/copper kit/i.test(t)) return each("pre-cut copper pair kit", true, "consumable", 1, "kit");

  // Tape: consumed in part-rolls, counted per roll
  if (/\btape\b/i.test(t)) return { stock_unit: "roll", pack_size: 1, pack_label: "roll", kind: "consumable", sure: true, reason: "tape roll" };

  // Coils / rolls / lengths sold whole, used per metre
  if (/\b(copper|aluminium|cabtyre|cable|trunking|conduit|pipe|tubing|insulation|arma ?flex)\b/i.test(t) && !/\b(nut|union|welding|tie|clip|saddle|coupler|elbow|tee|stop end|end cap|strip|cutter|bender|solder|lug|gland)\b/i.test(t)) {
    const len = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|mtr|metres?|meters?)(?![a-z])/i);
    if (len) {
      const size = num(len[1]);
      return m(size, packLabelFor(t), `${size} m ${packLabelFor(t)}, used per metre`);
    }
    if (/insulation/i.test(t)) return m(1.8, "length", "pipe insulation, length not in name: assumed 1.8 m lengths", false);
  }

  // Counted packs
  const pk = t.match(/(?:\/|p\/|box\s*)(\d{2,4})\b/i) ?? t.match(/\b(\d{2,4})\s*pack\b/i) ?? (lbl.match(/^(\d{2,4})\s*pack$/) as RegExpMatchArray | null);
  if (pk) return each(`box of ${num(pk[1])}, counted each`, true, "consumable", num(pk[1]), "box");

  // Liquids
  const lq = t.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|litres?|liters?)\b/i);
  if (lq) {
    const l = lq[2].toLowerCase() === "ml" ? num(lq[1]) / 1000 : num(lq[1]);
    return { stock_unit: "l", pack_size: l, pack_label: "bottle", kind: "consumable", sure: true, reason: `${l} L bottle/can, used per litre` };
  }
  // Powders by weight (flux)
  if (/\bflux powder\b/i.test(t)) {
    const w = t.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
    if (w) return { stock_unit: "kg", pack_size: num(w[1]) / 1000, pack_label: "jar", kind: "consumable", sure: true, reason: `${num(w[1])} g jar, used per kg` };
  }
  if (/\b(welding rod|silver solder)\b/i.test(t)) return each("brazing rod: counted per rod (pack size not in name)", false, "consumable", 1, "rod");
  if (/heat transfer compound/i.test(t)) return each("compound: counted per tube", false, "consumable", 1, "tube");
  if (/nail in anchor/i.test(t)) return each("anchor (name says 55m, means mm)", false);
  return each("counted each");
}

function packLabelFor(t: string) {
  if (/\b(copper|aluminium)\b/i.test(t)) return "coil";
  if (/\b(cabtyre|cable)\b/i.test(t)) return "roll";
  if (/\btape\b/i.test(t)) return "roll";
  return "length";
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Received quantity in stock units. `in` = what the doc counts: packs (default) or stock units already. */
export function toStockQty(qty: number, map: Pick<UnitMapping, "pack_size">, unitIn: "pack" | "stock" = "pack") {
  return round(unitIn === "pack" ? qty * (map.pack_size || 1) : qty);
}
/** Cost per stock unit from a price per pack (or per stock unit). */
export function costPerStockUnit(price: number, map: Pick<UnitMapping, "pack_size">, priceIn: "pack" | "stock" = "pack") {
  return round(priceIn === "pack" ? price / (map.pack_size || 1) : price, 4);
}
/**
 * Default quantity to draw from stock for one quote line.
 * Catalogue priced per metre ⇒ the quote quantity is already metres. Otherwise the quote counts packs.
 */
export function quoteDrawQty(quoteQty: number, product: CatalogueProduct, map: UnitMapping = stockUnitFor(product)) {
  const lbl = (product.price_per_unit_label ?? "").toLowerCase();
  if (map.stock_unit === "m" && (lbl === "m" || lbl === "metre" || lbl === "meter")) return round(quoteQty);
  return round(quoteQty * (map.pack_size || 1));
}
export const unitShort = (u: StockUnit) => ({ each: "ea", m: "m", kg: "kg", l: "L", roll: "roll" })[u];
