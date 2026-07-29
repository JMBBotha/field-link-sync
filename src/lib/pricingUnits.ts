/**
 * Unit-based pricing — single source of truth.
 *
 * Every catalog / bundle / quote item is priced as:
 *   lineTotal = (enteredQty / price_per_unit_qty) * unitPrice
 *
 * Backwards compatible: legacy meter items (sold_in_length + price_per_metre)
 * resolve to unit_type = "m", price_per_unit_qty = 1, label "m".
 */

export const UNIT_TYPES = [
  "each",
  "m",
  "g",
  "kg",
  "l",
  "ml",
  "roll",
  "box",
  "pack",
  "custom",
] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

export interface PricingUnit {
  unit_type: UnitType;
  /** Quantity that the unit price covers (1, 30, 100, 500 ...) */
  price_per_unit_qty: number;
  /** Human label shown next to inputs and prices ("each", "m", "500g", "30m roll") */
  price_per_unit_label: string;
  allows_decimal_qty: boolean;
  qty_step: number;
  min_qty: number;
}

export const DEFAULT_PRICING_UNIT: PricingUnit = {
  unit_type: "each",
  price_per_unit_qty: 1,
  price_per_unit_label: "each",
  allows_decimal_qty: false,
  qty_step: 1,
  min_qty: 1,
};

export const METER_PRICING_UNIT: PricingUnit = {
  unit_type: "m",
  price_per_unit_qty: 1,
  price_per_unit_label: "m",
  allows_decimal_qty: true,
  qty_step: 0.1,
  min_qty: 0,
};

/** Common presets offered in the Pricing Unit section of item forms. */
export const PRICING_UNIT_PRESETS: { id: string; label: string; value: PricingUnit }[] = [
  { id: "each", label: "Per item (each)", value: { ...DEFAULT_PRICING_UNIT } },
  { id: "m", label: "Per meter", value: { ...METER_PRICING_UNIT } },
  {
    id: "100m",
    label: "Per 100 m",
    value: { unit_type: "m", price_per_unit_qty: 100, price_per_unit_label: "100m", allows_decimal_qty: true, qty_step: 0.5, min_qty: 0 },
  },
  {
    id: "roll30",
    label: "Per 30 m roll",
    value: { unit_type: "roll", price_per_unit_qty: 30, price_per_unit_label: "30m roll", allows_decimal_qty: true, qty_step: 0.5, min_qty: 0 },
  },
  {
    id: "500g",
    label: "Per 500 g",
    value: { unit_type: "g", price_per_unit_qty: 500, price_per_unit_label: "500g", allows_decimal_qty: true, qty_step: 10, min_qty: 0 },
  },
  {
    id: "kg",
    label: "Per kg",
    value: { unit_type: "kg", price_per_unit_qty: 1, price_per_unit_label: "kg", allows_decimal_qty: true, qty_step: 0.1, min_qty: 0 },
  },
  {
    id: "l",
    label: "Per litre",
    value: { unit_type: "l", price_per_unit_qty: 1, price_per_unit_label: "l", allows_decimal_qty: true, qty_step: 0.1, min_qty: 0 },
  },
  { id: "box", label: "Per box", value: { ...DEFAULT_PRICING_UNIT, unit_type: "box", price_per_unit_label: "box" } },
  { id: "pack", label: "Per pack", value: { ...DEFAULT_PRICING_UNIT, unit_type: "pack", price_per_unit_label: "pack" } },
];

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseFloat(value) : (value as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

/**
 * Resolve the pricing unit for any record (catalog product, bundle item, quote item).
 * Falls back to legacy meter/each behaviour when the new columns are absent.
 */
export function resolvePricingUnit(source: any | null | undefined): PricingUnit {
  if (!source) return { ...DEFAULT_PRICING_UNIT };

  const raw = source.unit_type as UnitType | undefined;
  if (raw && (UNIT_TYPES as readonly string[]).includes(raw)) {
    const qty = Math.max(num(source.price_per_unit_qty, 1), 0.0001);
    const allowsDecimal =
      typeof source.allows_decimal_qty === "boolean"
        ? source.allows_decimal_qty
        : raw !== "each" && raw !== "box" && raw !== "pack";
    return {
      unit_type: raw,
      price_per_unit_qty: qty,
      price_per_unit_label: source.price_per_unit_label || defaultLabel(raw, qty),
      allows_decimal_qty: allowsDecimal,
      qty_step: Math.max(num(source.qty_step, allowsDecimal ? 0.1 : 1), 0.0001),
      min_qty: Math.max(num(source.min_qty, allowsDecimal ? 0 : 1), 0),
    };
  }

  // Legacy fallback
  const isLength = !!source.sold_in_length && num(source.price_per_metre, 0) > 0;
  return isLength ? { ...METER_PRICING_UNIT } : { ...DEFAULT_PRICING_UNIT };
}

export function defaultLabel(unitType: UnitType, perQty: number): string {
  if (unitType === "each") return "each";
  if (perQty === 1) return unitType;
  return `${trimNumber(perQty)}${unitType}`;
}

/** Trim float noise: 1.1499976158142 -> 1.15 */
export function roundQty(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

export function trimNumber(value: number): string {
  const rounded = roundQty(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * THE pricing formula for every unit-priced line.
 * lineTotal = (enteredQty / price_per_unit_qty) * unitPrice
 */
export function computeLineTotal(
  enteredQty: number,
  unitPrice: number,
  unit: PricingUnit | null | undefined
): number {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  const per = u.price_per_unit_qty > 0 ? u.price_per_unit_qty : 1;
  const qty = Number.isFinite(enteredQty) ? enteredQty : 0;
  const price = Number.isFinite(unitPrice) ? unitPrice : 0;
  return roundMoney((qty / per) * price);
}

/** "R141.93 per m", "R250.00 per 500g", "R120.00 per each" */
export function formatUnitPrice(unitPrice: number, unit: PricingUnit | null | undefined): string {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  return `R${roundMoney(unitPrice).toFixed(2)} per ${u.price_per_unit_label}`;
}

/** Short suffix used next to inputs: "m", "500g", "each" */
export function unitSuffix(unit: PricingUnit | null | undefined): string {
  return (unit ?? DEFAULT_PRICING_UNIT).price_per_unit_label;
}

/** Label for the quantity input's measured unit ("m", "g", "each", "roll") */
export function qtyUnitLabel(unit: PricingUnit | null | undefined): string {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  return u.unit_type === "each" ? "" : u.unit_type === "roll" ? "m" : u.unit_type;
}

/** Sanitize a typed quantity against min_qty / qty_step / allows_decimal_qty. */
export function sanitizeQty(raw: number, unit: PricingUnit | null | undefined): number {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  let v = Number.isFinite(raw) ? raw : u.min_qty;
  if (!u.allows_decimal_qty) v = Math.round(v);
  if (v < u.min_qty) v = u.min_qty;
  return roundQty(v);
}

/** Props to spread onto a quantity <Input type="number" /> */
export function qtyInputProps(unit: PricingUnit | null | undefined) {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  return {
    type: "number" as const,
    step: u.allows_decimal_qty ? u.qty_step : 1,
    min: u.min_qty,
    inputMode: (u.allows_decimal_qty ? "decimal" : "numeric") as "decimal" | "numeric",
  };
}

/** Nudge quantity up/down by one step, respecting min. */
export function stepQty(current: number, direction: 1 | -1, unit: PricingUnit | null | undefined): number {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  const step = u.allows_decimal_qty ? u.qty_step : Math.max(1, Math.round(u.qty_step));
  return sanitizeQty(current + direction * step, u);
}

/** Display a quantity without float noise: 1.1499976158142 -> "1.15" */
export function formatQty(value: number, unit?: PricingUnit | null): string {
  const u = unit ?? DEFAULT_PRICING_UNIT;
  const rounded = roundQty(value, u.allows_decimal_qty ? 3 : 0);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}
