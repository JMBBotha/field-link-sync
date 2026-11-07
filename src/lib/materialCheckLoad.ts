/** Turn a packing list and job_materials_plan into a material check. No prices. No guessed lengths. */
import { buildMaterialCheck, isInstallUnit, type CheckKind, type MaterialCheck, type SourceLine, type StockHand } from "@/lib/materialCheck";
import type { PackingRow } from "@/lib/packingList";

interface PlanItem {
  quote_item_id?: string;
  product_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  product?: {
    product_code?: string | null;
    short_name?: string | null;
    name?: string | null;
    description?: string | null;
    price_per_unit_label?: string | null;
    sold_in_length?: boolean | null;
    unit_length?: number | null;
    product_type?: string | null;
  } | null;
}
interface PlanStock {
  id?: string;
  product_id?: string | null;
  item?: string | null;
  qty_on_hand?: number | null;
}
export interface MaterialsPlan {
  items?: PlanItem[];
  stock?: PlanStock[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function lineFromPlan(item: PlanItem, href: string | null): SourceLine {
  const product = item.product || null;
  const name = item.item_name || product?.short_name || product?.name || "Item";
  const metres = product?.sold_in_length ? Number(item.quantity) : null;
  return {
    id: item.quote_item_id || name,
    name,
    code: product?.product_code || null,
    productId: item.product_id || null,
    productType: product?.product_type || null,
    quantity: item.quantity == null ? null : Number(item.quantity),
    lengthM: metres != null && Number.isFinite(metres) && metres > 0 ? metres : null,
    product: product ? {
      product_code: product.product_code,
      short_name: product.short_name,
      name: product.name,
      description: product.description,
      price_per_unit_label: product.price_per_unit_label,
      sold_in_length: product.sold_in_length,
      unit_length: product.unit_length,
    } : null,
    href,
    source: "quote",
  };
}

function lineFromPack(row: PackingRow, index: number, href: string | null): SourceLine {
  const metres = row.qty_unit === "metre" ? Number(row.quantity) : null;
  return {
    id: `pack-${index}-${row.item_code || row.item_name || "line"}`,
    name: row.item_name,
    code: row.item_code,
    quantity: row.quantity == null ? null : Number(row.quantity),
    lengthM: metres != null && Number.isFinite(metres) && metres > 0 ? metres : null,
    href,
    source: "quote",
  };
}

export function checkFromPackAndPlan(
  kind: CheckKind,
  pack: PackingRow[],
  plan: MaterialsPlan | null,
  quoteHref: string | null,
  recorded: SourceLine[] = [],
): MaterialCheck {
  const stockKnown = !!plan;
  const stock: StockHand[] = (plan?.stock || []).filter((s) => s.id).map((s) => ({
    id: s.id as string,
    label: s.item || "Stock",
    productId: s.product_id || null,
    qty: Number(s.qty_on_hand) || 0,
    href: `/admin/cash-health?tab=stock#stock-${s.id}`,
  }));
  const planLines = (plan?.items || []).map((item) => lineFromPlan(item, quoteHref));
  const planNames = new Set(planLines.map((l) => norm(l.name || "")));
  const unitLines = pack
    .map((row, i) => lineFromPack(row, i, quoteHref))
    .filter((l) => isInstallUnit(l) && !planNames.has(norm(l.name || "")));
  const lines = plan ? [...unitLines, ...planLines] : pack.map((row, i) => lineFromPack(row, i, quoteHref));
  return buildMaterialCheck({ kind, lines, recorded, stock, stockKnown });
}
