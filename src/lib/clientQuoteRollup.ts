/**
 * Client-facing quote roll-up.
 *
 * Staff keep the full costing breakdown (copper, Armaflex, drain, elbows,
 * labour…). Clients see ONE row per quote area: the room name, the unit
 * make/model + sales blurb, and a single area total that already includes all
 * the materials and labour in that area. Money is never recomputed here beyond
 * summing the same line totals staff see — quote totals stay the source of
 * truth for subtotal / discount / VAT / grand total.
 */

export interface RollupLine {
  id?: string;
  item_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  area_id?: string | null;
  area_name?: string | null;
  item_type?: string | null;
  parent_item_id?: string | null;
  category?: string | null;
  brand?: string | null;
  btu_rating?: number | string | null;
  capacity_btu?: number | string | null;
  kw?: number | string | null;
  image_url?: string | null;
  ai_sales_description?: string | null;
  sort_order?: number | null;
}

export interface RollupArea {
  id: string;
  name: string;
  sort_order?: number | null;
}

export interface ClientRollupUnit {
  unitName: string;
  unitDescription: string | null;
  imageUrl: string | null;
}

export interface ClientRollupArea {
  areaId: string | null;
  areaName: string;
  units: ClientRollupUnit[];
  areaTotal: number;
  /** True when the area also carries piping / materials / labour lines. */
  hasInstallExtras: boolean;
}

const UNIT_CATEGORY = /(air\s*con|aircon|midwall|mid-wall|inverter|cassette|under\s*ceiling|underceiling|console|ducted|split)/i;
const CONSUMABLE_CATEGORY = /consumable/i;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const lineTotal = (l: RollupLine) => {
  const t = Number(l.total_price);
  if (Number.isFinite(t) && t !== 0) return t;
  return num(l.quantity) * num(l.unit_price);
};

const isService = (l: RollupLine) => String(l.item_type || "").toLowerCase() === "service";
const isConsumable = (l: RollupLine) => CONSUMABLE_CATEGORY.test(String(l.category || ""));

/** Does this line look like the AC unit itself? */
const looksLikeUnit = (l: RollupLine) => {
  if (isService(l) || isConsumable(l)) return false;
  if (num(l.btu_rating) > 0 || num(l.capacity_btu) > 0 || num(l.kw) > 0) return true;
  return UNIT_CATEGORY.test(String(l.category || ""));
};

const toUnit = (l: RollupLine): ClientRollupUnit => ({
  unitName: (l.item_name || l.description || "Air conditioning unit").split("\n")[0],
  unitDescription: (l.ai_sales_description || l.description || null)?.trim() || null,
  imageUrl: l.image_url || null,
});

/**
 * Collapse full quote lines into one client-facing block per area.
 * Only top-level lines (no parent) are considered — children are already
 * excluded on the public payload.
 */
export function buildClientRollup(lines: RollupLine[], areas: RollupArea[] = []): ClientRollupArea[] {
  const top = (lines || []).filter((l) => !l.parent_item_id);
  const order = new Map<string, number>();
  areas.forEach((a, i) => order.set(a.id, Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : i));
  const names = new Map<string, string>();
  areas.forEach((a) => names.set(a.id, a.name));

  const groups = new Map<string, RollupLine[]>();
  for (const l of top) {
    const key = l.area_id || "__general__";
    const list = groups.get(key);
    if (list) list.push(l);
    else groups.set(key, [l]);
  }

  const out: ClientRollupArea[] = [];
  for (const [key, group] of groups) {
    const areaId = key === "__general__" ? null : key;
    const areaName =
      (areaId ? names.get(areaId) : null) || group.find((l) => l.area_name)?.area_name || (areaId ? "Area" : "General");

    let unitLines = group.filter(looksLikeUnit);
    if (!unitLines.length) {
      const fallback = group
        .filter((l) => !isService(l) && !isConsumable(l))
        .sort((a, b) => num(b.unit_price) - num(a.unit_price))[0];
      unitLines = fallback ? [fallback] : [];
    }
    const unitIds = new Set(unitLines.map((l) => l.id));

    out.push({
      areaId,
      areaName,
      units: unitLines.map(toUnit),
      areaTotal: group.reduce((sum, l) => sum + lineTotal(l), 0),
      hasInstallExtras: group.some((l) => !unitIds.has(l.id)),
    });
  }

  return out.sort((a, b) => {
    const oa = a.areaId ? order.get(a.areaId) ?? 9999 : 10000;
    const ob = b.areaId ? order.get(b.areaId) ?? 9999 : 10000;
    return oa - ob;
  });
}
