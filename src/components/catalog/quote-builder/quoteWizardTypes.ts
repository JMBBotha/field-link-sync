import type { PaletteProduct } from "../QuoteBuilderTab";
import { calculatePricing, exclVatFromIncl } from "@/utils/pricing";

export interface QuoteArea {
  id: string;
  name: string;
  acUnits: AreaACUnit[];
  materials: AreaMaterial[];
  brackets: AreaBracket[];
  consumables: AreaConsumable[];
  timeHours: number;
  subtotal: number;
  appliedBundleId?: string;
}

export interface AreaACUnit {
  id: string;
  product: PaletteProduct;
  btu: number;
  quantity: number;
}

export interface AreaMaterial {
  id: string;
  product: PaletteProduct;
  defaultLength: number;
  adjustedLength: number;
  costPerMeter: number;
  totalCost: number;
  /** "length" = sold per metre with slider, "unit" = sold per quantity */
  pricingMode: "length" | "unit";
  /** quantity when in "unit" mode */
  unitQuantity: number;
}

export interface AreaBracket {
  id: string;
  size: string; // "450mm" | "650mm" | "L-shape"
  quantity: number;
  price: number;
}

export interface AreaConsumable {
  id: string;
  product: PaletteProduct;
  quantity: number;
  /** Whether this was auto-added from suggested_consumables */
  isSuggested?: boolean;
}

export function getBracketSize(btu: number): string {
  if (btu <= 18000) return "450mm";
  if (btu <= 24000) return "650mm";
  return "L-shape";
}

export function detectBTU(product: PaletteProduct): number {
  const text = [product.short_name, product.description, product.product_code].join(" ");
  const match = text.match(/(\d{4,5})\s*(?:btu|BTU)/i);
  if (match) return parseInt(match[1], 10);
  // common BTU values from model numbers
  const btuMap: Record<string, number> = {
    "9": 9000, "12": 12000, "18": 18000, "24": 24000, "36": 36000, "48": 48000,
  };
  const codeMatch = text.match(/(?:^|\D)(9|12|18|24|36|48)(?:\D|$)/);
  if (codeMatch && btuMap[codeMatch[1]]) return btuMap[codeMatch[1]];
  return 12000; // fallback
}

export function createEmptyArea(name: string): QuoteArea {
  return {
    id: crypto.randomUUID(),
    name,
    acUnits: [],
    materials: [],
    brackets: [],
    consumables: [],
    timeHours: 2,
    subtotal: 0,
  };
}

export function computeAreaSubtotal(area: QuoteArea): number {
  /** cost_price is the source of truth — already excl VAT, after any discount */
  const getCost = (p: any) => {
    if (p?.cost_price > 0) return p.cost_price;
    if (p?.cost_excl_vat > 0) return p.cost_excl_vat;
    return p?.selling_price || p?.price_per_metre || 0;
  };
  const acCost = area.acUnits.reduce((s, u) => s + getCost(u.product) * u.quantity, 0);
  const matCost = area.materials.reduce((s, m) => {
    if (m.pricingMode === "unit") {
      return s + getCost(m.product) * m.unitQuantity;
    }
    const perM = m.costPerMeter || getCost(m.product);
    return s + (m.totalCost || perM * m.adjustedLength);
  }, 0);
  const bracketCost = area.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
  const consCost = area.consumables.reduce((s, c) => s + getCost(c.product) * c.quantity, 0);
  return acCost + matCost + bracketCost + consCost;
}

export const WIZARD_STEPS = [
  { label: "Areas", description: "Define rooms" },
  { label: "AC Units", description: "Select units" },
  { label: "Pricing", description: "Markup & totals" },
  { label: "Time", description: "Labour hours" },
  { label: "Review", description: "Summary" },
] as const;
