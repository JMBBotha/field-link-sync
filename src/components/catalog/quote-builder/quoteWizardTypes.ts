import type { PaletteProduct } from "../QuoteBuilderTab";

export interface QuoteArea {
  id: string;
  name: string;
  acUnits: AreaACUnit[];
  materials: AreaMaterial[];
  brackets: AreaBracket[];
  consumables: AreaConsumable[];
  timeHours: number;
  subtotal: number;
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
  const acCost = area.acUnits.reduce((s, u) => s + (u.product.selling_price || u.product.cost_incl_vat || 0) * u.quantity, 0);
  const matCost = area.materials.reduce((s, m) => s + m.totalCost, 0);
  const bracketCost = area.brackets.reduce((s, b) => s + b.price * b.quantity, 0);
  const consCost = area.consumables.reduce((s, c) => s + (c.product.selling_price || c.product.cost_incl_vat || 0) * c.quantity, 0);
  return acCost + matCost + bracketCost + consCost;
}

export const WIZARD_STEPS = [
  { label: "Areas", description: "Define rooms" },
  { label: "AC Units", description: "Select units" },
  { label: "Materials & Extras", description: "Piping, brackets & consumables" },
  { label: "Time", description: "Labour hours" },
  { label: "Review", description: "Summary" },
] as const;
