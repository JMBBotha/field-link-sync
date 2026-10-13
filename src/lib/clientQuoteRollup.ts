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
  /** False when the area carries no labour line (labour mode 'job'): client wording drops "& labour". */
  hasLabour?: boolean;
  /** Whole-job labour line (labour mode 'job'): sell price only. Never produced since 2026-10-13 (labour is folded). */
  isJobLabour?: boolean;
  /** Priced client lines (Johan 2026-10-13): each unit/service with its share of labour + install extras folded in. */
  items: ClientRollupItem[];
}

/** One client document line: labour and install materials are never their own amount, they are folded in by price. */
export interface ClientRollupItem {
  id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  quantity: number;
  /** "3 m" for per-metre lines, else null. */
  qtyText: string | null;
  /** Line total / qty (display), incl. the folded share. */
  unitPrice: number;
  /** Rounded to cents. Sum of every item = sum of every top-level line (= stored subtotal). */
  lineTotal: number;
  imageUrl: string | null;
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
const LABOUR_NAME = /^\s*(labou?r\b|installation\s*fee\b|ac\s+installation\s*$|installation\s*$)|\binstall(ation)?\s+fee\b/i;
const isLabour = (l: RollupLine) => typeOf(l) === "labour" || !!l.metadata?.labour || (!l.product_id && LABOUR_NAME.test(String(l.item_name || "")));
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
export function buildClientRollup(lines: RollupLine[], areas: RollupArea[] = [], opts: { targetSubtotal?: number | null } = {}): ClientRollupArea[] {
  const top = (lines || []).filter((l) => !l.parent_item_id);
  const order = new Map<string, number>();
  areas.forEach((a, i) => order.set(a.id, Number.isFinite(Number(a.sort_order)) && a.sort_order != null ? Number(a.sort_order) : i));
  const names = new Map<string, string>();
  areas.forEach((a) => names.set(a.id, a.name));

  // Job labour (labour_scope 'job' or labour with no area) is spread across the WHOLE quote, never shown alone.
  const isJob = (l: RollupLine) => isLabour(l) && (!l.area_id || l.metadata?.labour_scope === "job");
  const groups = new Map<string, RollupLine[]>();
  const jobPool: RollupLine[] = [];
  for (const l of top) {
    if (isJob(l)) { jobPool.push(l); continue; }
    const key = l.area_id || "__general__";
    const list = groups.get(key);
    if (list) list.push(l);
    else groups.set(key, [l]);
  }

  type Work = { area: ClientRollupArea; bases: { line: RollupLine; cents: number }[]; extraCents: number };
  const work: Work[] = [];
  for (const [key, group] of groups) {
    const areaTotal = group.reduce((sum, l) => sum + lineTotal(l), 0);
    const areaId = key === "__general__" ? null : key;
    const areaName =
      (areaId ? names.get(areaId) : null) || group.find((l) => l.area_name)?.area_name || (areaId ? "Area" : "General");

    // Legacy summary units (kept for older callers).
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
      if (areaTotal === 0) continue;
      units = [{ unitName: "Installation / service", unitDescription: null, imageUrl: null }];
    }
    const shownIds = new Set(shown.map((l) => l.id));

    // Priced client lines: every priced, non-labour, non-install-material line; labour + extras folded in.
    const priced = group.filter((l) => !isLabour(l) && !isInstallMaterial(l) && lineTotal(l) !== 0);
    const bases = priced.map((l) => ({ line: l, cents: Math.round(lineTotal(l) * 100) }));
    const extraCents = Math.round(group.reduce((s2, l) => s2 + lineTotal(l), 0) * 100) - bases.reduce((s2, b) => s2 + b.cents, 0);
    work.push({
      area: {
        areaId, areaName, units, areaTotal,
        hasInstallExtras: !serviceOnly && shown.length > 0 && group.some((l) => !shownIds.has(l.id) && (isLabour(l) || isInstallMaterial(l)) && lineTotal(l) !== 0),
        hasLabour: group.some((l) => isLabour(l) && lineTotal(l) !== 0),
        items: [],
      },
      bases, extraCents,
    });
  }

  const jobCents = Math.round(jobPool.reduce((s2, l) => s2 + lineTotal(l), 0) * 100);
  if (jobCents !== 0 && !work.some((w) => w.bases.length)) {
    // Only labour on the quote: one "Installation / service" block.
    const general = work.find((w) => !w.area.areaId);
    if (general) general.extraCents += jobCents;
    else work.push({ area: { areaId: null, areaName: "General", units: [{ unitName: "Installation / service", unitDescription: null, imageUrl: null }], areaTotal: 0, hasInstallExtras: false, hasLabour: true, items: [] }, bases: [], extraCents: jobCents });
  } else if (jobCents !== 0) {
    // Spread job labour over every priced line in the quote, by price.
    const all = work.flatMap((w) => w.bases.map((b) => ({ w, b })));
    const shares = allocateCents(jobCents, all.map((x) => x.b.cents));
    all.forEach((x, i) => { x.b.cents += shares[i]; });
    // areaTotal for the legacy summary
    work.forEach((w) => { w.area.areaTotal = 0; });
  }

  for (const w of work) {
    const shares = w.bases.length ? allocateCents(w.extraCents, w.bases.map((b) => b.cents)) : [];
    w.bases.forEach((b, i) => { b.cents += shares[i]; });
    if (!w.bases.length && w.extraCents !== 0) {
      w.area.items = [{ id: null, name: "Installation / service", code: null, description: null, quantity: 1, qtyText: null, unitPrice: w.extraCents / 100, lineTotal: w.extraCents / 100, imageUrl: null }];
    } else {
      w.area.items = w.bases.map(({ line: l, cents }) => {
        const asUnit = !isService(l);
        const qty = num(l.quantity) || 1;
        const metre = l.metadata?.qty_unit === "metre";
        const name = firstLine(l.item_name) || firstLine(l.description) || (asUnit ? "Air conditioning unit" : "Service");
        const code = String(l.item_number || l.product_code || "").trim() || null;
        return {
          id: l.id ?? null,
          name,
          code: code && !name.toLowerCase().includes(code.toLowerCase()) ? code : null,
          description: clientDescription(l),
          quantity: metre ? 1 : qty,
          qtyText: lineQtyText(l),
          unitPrice: Math.round(cents / (metre ? 1 : qty)) / 100,
          lineTotal: cents / 100,
          imageUrl: asUnit ? l.image_url || null : null,
        };
      });
    }
    w.area.areaTotal = w.area.items.reduce((s2, it) => s2 + Math.round(it.lineTotal * 100), 0) / 100;
  }

  // qty > 1: keep total = qty x rate to the cent; the odd cents move to a qty-1 line (else stay).
  const flat = work.flatMap((w) => w.area.items);
  const lastSingle = (list: ClientRollupItem[]) => [...list].reverse().find((it) => it.quantity === 1 && !it.qtyText);
  for (const w of work) for (const it of w.area.items) {
    // Same room first, so room subtotals stay exact; else any qty-1 line in the quote.
    const single = lastSingle(w.area.items) || lastSingle(flat);
    if (it.qtyText || !(Number.isInteger(it.quantity) && it.quantity > 1) || !single) continue;
    const c = Math.round(it.lineTotal * 100);
    const rem = c % it.quantity;
    if (!rem) continue;
    it.lineTotal = (c - rem) / 100;
    it.unitPrice = (c - rem) / it.quantity / 100;
    single.lineTotal = (Math.round(single.lineTotal * 100) + rem) / 100;
    single.unitPrice = single.lineTotal;
  }
  for (const w of work) w.area.areaTotal = w.area.items.reduce((s2, it) => s2 + Math.round(it.lineTotal * 100), 0) / 100;

  // Reconcile to the stored subtotal (cents drift from old rows only; never more than R1).
  const target = opts.targetSubtotal;
  if (target != null && Number.isFinite(Number(target))) {
    const have = work.reduce((s2, w) => s2 + Math.round(w.area.areaTotal * 100), 0);
    const diff = Math.round(Number(target) * 100) - have;
    const last = [...work].reverse().find((w) => w.area.items.some((x) => x.quantity === 1)) || [...work].reverse().find((w) => w.area.items.length);
    if (diff !== 0 && Math.abs(diff) <= 100 && last) {
      const it = [...last.area.items].reverse().find((x) => x.quantity === 1) || last.area.items[last.area.items.length - 1];
      const cents = Math.round(it.lineTotal * 100) + diff;
      it.lineTotal = cents / 100;
      it.unitPrice = Math.round(cents / (it.quantity || 1)) / 100;
      last.area.areaTotal = last.area.items.reduce((s2, x) => s2 + Math.round(x.lineTotal * 100), 0) / 100;
    }
  }

  return work
    .map((w) => w.area)
    .filter((a) => a.items.length > 0)
    .sort((a, b) => {
      const oa = a.areaId ? order.get(a.areaId) ?? 9999 : 10000;
      const ob = b.areaId ? order.get(b.areaId) ?? 9999 : 10000;
      return oa - ob;
    });
}

/** Split `pool` cents across weights by proportion; remainder on the last weight. Zero weights split equally. */
export function allocateCents(pool: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const w = weights.map((x) => Math.max(0, x));
  const total = w.reduce((a, b) => a + b, 0);
  const basis = total > 0 ? w : w.map(() => 1);
  const sum = total > 0 ? total : w.length;
  const out = basis.map((x) => Math.trunc((pool * x) / sum));
  out[out.length - 1] += pool - out.reduce((a, b) => a + b, 0);
  return out;
}

/** Sum of the client lines in cents (tests + guards). */
export function rollupCents(areas: ClientRollupArea[]): number {
  return areas.reduce((s2, a) => s2 + a.items.reduce((t, it) => t + Math.round(it.lineTotal * 100), 0), 0);
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

export interface FlatDocLine { name: string; description?: string | null; quantity: number; unit_price: number; amount: number; qtyText?: string | null; room?: string | null; isLabour?: boolean }

/** Is this flat document line labour (stored as labour, or a labour / installation-fee name)? */
export const isLabourText = (name?: string | null) => LABOUR_NAME.test(String(name || ""));

/**
 * Flat client lines (invoices, legacy quote PDFs): labour is folded into the other lines by price,
 * within the same room when the room has priced lines, else across the whole document.
 * Never changes the sum (cents). Only labour lines disappear; everything else is kept in order.
 */
export function foldFlatLines<T extends FlatDocLine>(lines: T[]): T[] {
  const cents = (n: number) => Math.round((Number(n) || 0) * 100);
  const rows = lines.map((l) => ({ l, c: cents(l.amount), lab: !!l.isLabour || isLabourText(l.name) }));
  const keep = rows.filter((r) => !r.lab && r.c !== 0);
  if (!keep.length) {
    const pool = rows.reduce((s2, r) => s2 + r.c, 0);
    if (!pool) return lines.filter((l) => cents(l.amount) !== 0);
    return [{ ...(lines[0] as T), name: "Installation / service", description: null, quantity: 1, unit_price: pool / 100, amount: pool / 100, qtyText: null }];
  }
  let jobPool = 0;
  const byRoom = new Map<string, number>();
  for (const r of rows.filter((x) => x.lab)) {
    const room = r.l.room || "";
    if (room && keep.some((k) => (k.l.room || "") === room)) byRoom.set(room, (byRoom.get(room) || 0) + r.c);
    else jobPool += r.c;
  }
  for (const [room, pool] of byRoom) {
    const group = keep.filter((k) => (k.l.room || "") === room);
    allocateCents(pool, group.map((g) => g.c)).forEach((sh, i) => { group[i].c += sh; });
  }
  if (jobPool) allocateCents(jobPool, keep.map((k) => k.c)).forEach((sh, i) => { keep[i].c += sh; });
  return keep.map(({ l, c }) => {
    const q = Number(l.quantity) || 1;
    const metre = !!l.qtyText;
    return { ...l, amount: c / 100, unit_price: Math.round(c / (metre ? 1 : q)) / 100 };
  });
}
