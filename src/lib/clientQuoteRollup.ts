/**
 * Client-facing quote roll-up (shared by the /quote page and every client PDF).
 *
 * Staff keep the full costing breakdown (copper, Armaflex, drain, elbows,
 * labour…). Clients see ONE block per quote area, in area order: the room
 * name, each unit as "qty × name, model" with its edited line description,
 * and a single area total that already includes all the materials and labour
 * in that area. Service-only areas show the service name + description.
 * Kit / material / labour lines are never listed. Money is never recomputed
 * here beyond summing the same line totals staff see — quote totals stay the
 * source of truth for subtotal / discount / VAT / grand total.
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
  product_id?: string | null;
  /** Model code on the quote line (copied from the catalogue product_code). */
  item_number?: string | null;
  /** supplier_products.product_code — fallback model code. */
  product_code?: string | null;
  is_bundle?: boolean | null;
  metadata?: any;
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
  /** Whole-job labour line (labour mode 'job'): sell price only. */
  isJobLabour?: boolean;
}

const UNIT_CATEGORY = /(air\s*con|aircon|midwall|mid-wall|inverter|cassette|under\s*ceiling|underceiling|console|ducted|split)/i;
const CONSUMABLE_CATEGORY = /consumable/i;
const INSTALL_TYPE = /^(installation kit|consumables)$/i;
const INSTALL_NAME = /copper|arma ?flex|insulation|lasso|cable tie|trunking|end cap|bracket|flatback|docking channel|pvc pipe|pvc elbow|drain|piping kit/i;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const lineTotal = (l: RollupLine) => {
  const t = Number(l.total_price);
  if (Number.isFinite(t) && t !== 0) return t;
  return num(l.quantity) * num(l.unit_price);
};

const typeOf = (l: RollupLine) => String(l.item_type || "").trim().toLowerCase();
const isLabour = (l: RollupLine) => typeOf(l) === "labour" || !!l.metadata?.labour;
const isService = (l: RollupLine) => typeOf(l) === "service" || !!l.metadata?.catalog_service_id;
const isInstallMaterial = (l: RollupLine) =>
  !!l.is_bundle ||
  !!l.metadata?.kit ||
  !!l.metadata?.install ||
  INSTALL_TYPE.test(String(l.item_type || "").trim()) ||
  CONSUMABLE_CATEGORY.test(String(l.category || "")) ||
  INSTALL_NAME.test(String(l.item_name || ""));

/** Does this line look like the AC unit itself? */
const looksLikeUnit = (l: RollupLine) => {
  if (isLabour(l) || isService(l) || isInstallMaterial(l)) return false;
  if (num(l.btu_rating) > 0 || num(l.capacity_btu) > 0 || num(l.kw) > 0) return true;
  return UNIT_CATEGORY.test(String(l.category || ""));
};

const firstLine = (s?: string | null) => String(s || "").split("\n")[0].trim();
const qtyText = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);

/**
 * Units: "2 × Samsung 12K INV MW, AR40F12C0AG/FA" (qty prefix only when more than one).
 * Services (asUnit=false): the plain service name — their quantity is often hours.
 */
export function clientLineLabel(l: RollupLine, asUnit = true): string {
  const name = firstLine(l.item_name) || firstLine(l.description) || (asUnit ? "Air conditioning unit" : "Service");
  if (!asUnit) return name;
  const code = String(l.item_number || l.product_code || "").trim();
  const named = code && !name.toLowerCase().includes(code.toLowerCase()) ? `${name}, ${code}` : name;
  const q = num(l.quantity);
  return q > 1 ? `${qtyText(q)} × ${named}` : named;
}

/** The edited line description wins; the catalogue AI blurb is only a fallback. */
const clientDescription = (l: RollupLine) => {
  const own = l.item_name ? l.description : null;
  return String(own || l.ai_sales_description || "").trim() || null;
};

const toUnit = (l: RollupLine, asUnit = true): ClientRollupUnit => ({
  unitName: clientLineLabel(l, asUnit),
  unitDescription: clientDescription(l),
  imageUrl: asUnit ? l.image_url || null : null,
});

/**
 * Collapse full quote lines into one client-facing block per area.
 * Only top-level lines (no parent) are considered — children are already
 * excluded on the public payload. Areas with no lines (or only zero-value
 * labour/material rows) are skipped. No-area labour becomes a final
 * "Job labour" block.
 */
export function buildClientRollup(lines: RollupLine[], areas: RollupArea[] = []): ClientRollupArea[] {
  const top = (lines || []).filter((l) => !l.parent_item_id);
  const order = new Map<string, number>();
  areas.forEach((a, i) => order.set(a.id, Number.isFinite(Number(a.sort_order)) && a.sort_order != null ? Number(a.sort_order) : i));
  const names = new Map<string, string>();
  areas.forEach((a) => names.set(a.id, a.name));

  const groups = new Map<string, RollupLine[]>();
  for (const l of top) {
    const key = l.area_id || (isLabour(l) ? "__job_labour__" : "__general__");
    const list = groups.get(key);
    if (list) list.push(l);
    else groups.set(key, [l]);
  }

  const out: ClientRollupArea[] = [];
  for (const [key, group] of groups) {
    const areaTotal = group.reduce((sum, l) => sum + lineTotal(l), 0);
    if (key === "__job_labour__") {
      if (areaTotal !== 0) out.push({ areaId: null, areaName: "Job labour", units: [], areaTotal, hasInstallExtras: false, isJobLabour: true });
      continue;
    }
    const areaId = key === "__general__" ? null : key;
    const areaName =
      (areaId ? names.get(areaId) : null) || group.find((l) => l.area_name)?.area_name || (areaId ? "Area" : "General");

    // 1. AC units; 2. else the priciest other product; 3. else services; 4. else a plain label.
    let shown = group.filter(looksLikeUnit);
    if (!shown.length) {
      shown = group
        .filter((l) => !isLabour(l) && !isService(l) && !isInstallMaterial(l))
        .sort((a, b) => num(b.unit_price) - num(a.unit_price))
        .slice(0, 1);
    }
    let units = shown.map((l) => toUnit(l));
    let serviceOnly = false;
    if (!units.length) {
      shown = group.filter((l) => isService(l) && !isLabour(l));
      units = shown.map((l) => toUnit(l, false));
      serviceOnly = units.length > 0;
    }
    if (!units.length) {
      if (areaTotal === 0) continue; // empty area: nothing billable to show
      units = [{ unitName: group.some(isLabour) && group.every((l) => isLabour(l) || lineTotal(l) === 0) ? "Labour" : "Installation materials", unitDescription: null, imageUrl: null }];
    }
    const shownIds = new Set(shown.map((l) => l.id));
    out.push({
      areaId,
      areaName,
      units,
      areaTotal,
      hasInstallExtras: !serviceOnly && shown.length > 0 && group.some((l) => !shownIds.has(l.id) && (isLabour(l) || isInstallMaterial(l)) && lineTotal(l) !== 0),
    });
  }

  return out.sort((a, b) => {
    const oa = a.isJobLabour ? 10001 : a.areaId ? order.get(a.areaId) ?? 9999 : 10000;
    const ob = b.isJobLabour ? 10001 : b.areaId ? order.get(b.areaId) ?? 9999 : 10000;
    return oa - ob;
  });
}

/**
 * Flatten a quote_items row (with nested supplier_products) into the exact
 * shape get_public_quote returns, so the staff PDF and /quote share one input.
 */
export function rollupLineFromRow(r: any, areaNames?: Map<string, string>): RollupLine {
  const sp = r?.supplier_products || {};
  return {
    id: r.id,
    item_name: r.item_name ?? null,
    description: r.description ?? null,
    quantity: r.quantity,
    unit_price: r.unit_price,
    total_price: r.total_price,
    sort_order: r.sort_order ?? null,
    product_id: r.product_id ?? null,
    area_id: r.area_id ?? null,
    area_name: r.area_id ? areaNames?.get(r.area_id) ?? null : null,
    item_type: r.item_type ?? null,
    item_number: r.item_number ?? null,
    is_bundle: r.is_bundle ?? null,
    image_url: sp.image_url ?? null,
    category: sp.category ?? null,
    brand: sp.brand ?? null,
    btu_rating: sp.btu_rating ?? null,
    capacity_btu: sp.capacity_btu ?? null,
    kw: sp.kw ?? null,
    ai_sales_description: sp.ai_sales_description ?? null,
    product_code: sp.product_code ?? null,
  };
}

/** Quote-level discount exactly as the /quote page (ClientProposalView) computes it: percent/percentage of subtotal, else a rand amount. */
export function clientDiscount(subtotal: number, type?: string | null, value?: number | string | null) {
  const v = Number(value) || 0;
  const pct = type === "percent" || type === "percentage";
  const amount = v > 0 ? (pct ? (Number(subtotal) || 0) * (v / 100) : v) : 0;
  return { amount, label: pct && v > 0 ? `${v}%` : null };
}

/** Quantity text for a client document line: "3 m" / "1.5 m" for per-metre trunking, else null (plain qty). */
export function lineQtyText(l: { quantity?: number | string | null; metadata?: any }): string | null {
  if (l?.metadata?.qty_unit !== "metre") return null;
  return `${Math.round(num(l.quantity) * 100) / 100} m`;
}
