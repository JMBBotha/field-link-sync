/**
 * Mandy quote mode: Grok plan → matched lines (ONE shared matcher) → the
 * existing breakdown card → write through addCatalogProductToQuote.
 *
 * Grok (mandy-quote-plan) only turns speech into { items: [{ query, qty,
 * length_m, area, kind }] }. Every product is resolved here with matchCatalog;
 * prices come from catalogLineFields (the one pricing path). AC units get the
 * standard install (kit via pickKitForUnit); spoken piping metres set the kit
 * length, and a spoken quantity of an install product (e.g. "2 trunking
 * lengths") sets that install line's quantity instead of adding a duplicate.
 */
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { QuoteItem, QuoteItemInsert } from "@/types/quote";
import type { InstallTemplate } from "@/lib/installTemplates";
import { matchCatalog, type CatalogHit } from "@/lib/mandy/catalogMatch";
import {
  addCatalogProductToQuote, catalogLineFields, isAirConditioningProduct, planStandardInstall, type BundleForKit,
} from "@/lib/mandy/quoteOps";
import { serviceLine, type SceneBreakdown, type SceneLine, type ServiceRow } from "@/lib/voiceQuoteKit";

export type PlanKind = "unit" | "piping" | "labour" | "item";
export interface QuotePlanItem { query: string; qty?: number | null; length_m?: number | null; area?: string | null; kind?: PlanKind | null }
export interface QuotePlan { items: QuotePlanItem[]; client?: string | null }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Never trust the model's JSON shape. */
export function sanitizePlan(raw: unknown): QuotePlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 30).map((i: any): QuotePlanItem => ({
    query: String(i?.query ?? "").trim().slice(0, 120),
    qty: num(i?.qty),
    length_m: num(i?.length_m),
    area: i?.area ? String(i.area).trim().slice(0, 60) : null,
    kind: (["unit", "piping", "labour", "item"] as const).includes(i?.kind) ? i.kind : "item",
  })).filter((i: QuotePlanItem) => i.query || i.kind === "piping" || i.kind === "labour");
  const client = r.client ? String(r.client).trim().slice(0, 80) : null;
  return { items, client: client || null };
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const codeOf = (p?: { product_code?: string | null } | null) => String(p?.product_code || "").trim().toUpperCase();

/** Preview line priced exactly like the write (catalogLineFields). */
export function planLine(p: PaletteProduct, qty: number, spoken: string, meta: Record<string, unknown> = {}): SceneLine {
  const f = catalogLineFields(p, qty);
  const perLength = !!f.metadata.supplier_length_m;
  return {
    id: uid(),
    label: p.short_name || p.product_code || "Product",
    product: p,
    quantity: qty,
    unitLabel: perLength ? `× ${f.metadata.supplier_length_m} m length` : (p.price_per_unit_label || "each"),
    unitPrice: f.unit_price,
    unitCost: Number(f.metadata.unit_cost) || 0,
    markupPct: Number(f.metadata.markup_percent) || 0,
    meta: { voice: true, mandy_plan: true, ...meta },
    status: "ok",
    spoken,
  };
}

const stub = (label: string, spoken: string, status: SceneLine["status"], hint: string, meta: Record<string, unknown> = {}): SceneLine =>
  ({ id: uid(), label, quantity: 1, unitLabel: "each", unitPrice: 0, unitCost: 0, markupPct: 0, meta: { voice: true, ...meta }, status, hint, spoken });

export interface ResolveCtx {
  products: PaletteProduct[];
  bundles: BundleForKit[];
  templates: InstallTemplate[];
  services?: ServiceRow[];
  fallbackArea?: string;
}

/** Qty for a matched product: explicit plan qty, else the matcher's spoken qty, else metres → supplier lengths. */
function qtyFor(item: QuotePlanItem, m: { qty: number | null; lengthM: number | null }, p: PaletteProduct): number {
  if (item.qty) return item.qty;
  if (m.qty) return m.qty;
  const len = item.length_m ?? m.lengthM;
  const unitLen = Number(p.unit_length) || 0;
  if (len && p.sold_in_length && unitLen > 0) return Math.max(1, Math.ceil(len / unitLen - 1e-9));
  return 1;
}

/** Plan → the breakdown card, grouped by area. Nothing is written. */
export function resolvePlan(plan: QuotePlan, ctx: ResolveCtx, transcript = ""): SceneBreakdown {
  const areas = new Map<string, { key: string; name: string; lines: SceneLine[]; notes: string[]; unparsed: string[] }>();
  const areaFor = (name?: string | null) => {
    const n = (name || ctx.fallbackArea || "Items").trim();
    const k = n.toLowerCase();
    if (!areas.has(k)) areas.set(k, { key: k, name: n, lines: [], notes: [], unparsed: [] });
    return areas.get(k)!;
  };
  const lastUnit = (a: ReturnType<typeof areaFor>) => [...a.lines].reverse().find((l) => l.meta.ac_unit && l.product);
  const setKitLength = (unit: SceneLine, m: number) => {
    unit.meta.kit_length_m = m;
    unit.hint = installHint(unit);
  };
  const installHint = (unit: SceneLine) => {
    const codes = (unit.meta.install_codes as string[]) || [];
    const kitM = unit.meta.kit_length_m ?? unit.meta.default_kit_m;
    return `+ standard install${unit.meta.kit_name ? `: ${unit.meta.kit_name} at ${kitM} m` : ""}${codes.length ? `, ${codes.join(", ")}` : ""}`;
  };

  for (const item of plan.items) {
    const a = areaFor(item.area);
    const spoken = item.query || item.kind || "";
    if (item.kind === "labour") {
      const svc = (ctx.services || []).find((s) => /labour/i.test(s.name) && (!item.query || s.name.toLowerCase().includes(item.query.toLowerCase().replace(/labou?r/g, "").trim()))) ||
        (ctx.services || []).find((s) => /labour/i.test(s.name));
      const hours = item.qty ?? 1;
      a.lines.push(svc ? { ...serviceLine(svc, hours), status: "ok", spoken } : stub("Labour", spoken, "missing", "No labour service in Services."));
      continue;
    }
    const m = item.query ? matchCatalog(item.query, ctx.products as any[], ctx.bundles as any[]) : null;
    const pipingOnly = item.kind === "piping" || (m?.pick?.kind === "kit") || (!!m && m.ranked[0]?.kind === "kit");
    if (pipingOnly) {
      const unit = lastUnit(a);
      const metres = item.length_m ?? m?.lengthM ?? item.qty ?? null;
      if (unit && metres) { setKitLength(unit, metres); continue; }
      if (unit) continue; // kit already comes with the unit
      a.lines.push(stub(`Piping${metres ? ` ${metres} m` : ""}`, spoken, "incomplete", "Piping comes with a unit's standard install — add the unit first."));
      continue;
    }
    if (!m || !m.ranked.length) { a.lines.push(stub(item.query || "Item", spoken, "missing", `Nothing on the live catalog matches “${item.query}”.`)); continue; }

    // A spoken install product (e.g. trunking) on an area with a unit → set that install line's qty.
    const unit = lastUnit(a);
    const installCodes = new Set(((unit?.meta.install_codes as string[]) || []));
    const hits = (m.pick ? [m.pick] : m.options).filter((h): h is Extract<CatalogHit, { kind: "product" }> => h.kind === "product");
    const installHit = unit ? hits.find((h) => installCodes.has(codeOf(h.product))) || m.ranked.find((h) => h.kind === "product" && installCodes.has(codeOf(h.product))) as any : null;
    if (unit && installHit) {
      const p = installHit.product as PaletteProduct;
      const q = qtyFor(item, m, p);
      const overrides = { ...((unit.meta.install_qty as Record<string, number>) || {}), [codeOf(p)]: q };
      unit.meta.install_qty = overrides;
      a.lines.push({ ...planLine(p, q, spoken, { install_of: unit.id }), hint: "Standard install quantity" });
      continue;
    }

    const first = hits[0] ?? (m.ranked.find((h) => h.kind === "product") as Extract<CatalogHit, { kind: "product" }> | undefined);
    if (!first) { a.lines.push(stub(item.query, spoken, "missing", `Nothing on the live catalog matches “${item.query}”.`)); continue; }
    const p = first.product as PaletteProduct;
    const q = qtyFor(item, m, p);
    const line = planLine(p, q, spoken);
    if (!m.pick) {
      line.status = "ambiguous";
      line.hint = "Tap the right model";
      line.productCandidates = m.options.filter((h) => h.kind === "product").map((h: any) => h.product as PaletteProduct);
    }
    if (isAirConditioningProduct(p)) {
      const ip = planStandardInstall(p, ctx.templates, ctx.bundles, ctx.products);
      line.meta.ac_unit = true;
      line.meta.install_codes = ip.lines.map((l) => codeOf(l.product));
      line.meta.kit_name = ip.kitBundle?.name ?? null;
      line.meta.default_kit_m = ip.kitLength;
      if (item.length_m) line.meta.kit_length_m = item.length_m;
      line.hint = [line.hint, installHint(line)].filter(Boolean).join(" · ");
    }
    a.lines.push(line);
  }
  return { transcript, areas: [...areas.values()] };
}

type AddItemFn = (item: Omit<QuoteItemInsert, "quote_id">) => Promise<QuoteItem | null>;

export interface WriteDeps {
  addItem: AddItemFn;
  addArea: (name: string) => Promise<{ id: string; name: string } | null>;
  areas: { id: string; name: string }[];
  sortStart: number;
  templates: InstallTemplate[];
  bundles: BundleForKit[];
  products: PaletteProduct[];
}

/** Confirmed card → quote rows. Returns every new row id (for undo) and install notes. */
export async function writeBreakdown(bd: SceneBreakdown, d: WriteDeps) {
  const ids: string[] = [];
  const notes: string[] = [];
  let sort = d.sortStart;
  const created = new Map<string, string>();
  for (const g of bd.areas) {
    const saveable = g.lines.filter((l) => (l.status === "ok" || l.status === "ambiguous") && (l.product || l.service));
    if (!saveable.length) continue;
    const key = g.name.trim().toLowerCase();
    let areaId = created.get(key) ?? d.areas.find((a) => a.name.trim().toLowerCase() === key)?.id ?? null;
    if (!areaId) {
      const row = await d.addArea(g.name.trim() || "Items");
      if (!row) throw new Error(`Could not create area “${g.name}”.`);
      areaId = row.id;
    }
    created.set(key, areaId);
    const unitIds = new Set(saveable.filter((l) => l.meta.ac_unit).map((l) => l.id));
    for (const l of saveable) {
      if (l.meta.install_of && unitIds.has(String(l.meta.install_of))) continue; // folded into the unit's install
      if (l.service) {
        const row = await d.addItem({
          area_id: areaId, parent_item_id: null, product_id: null, item_name: l.label, item_number: null,
          description: l.service.category ?? null, supplier: null, quantity: l.quantity, length: null,
          unit_price: l.unitPrice, total_price: null, is_bundle: false, item_type: "service",
          metadata: { unit_cost: 0, markup_percent: 0, spoken: l.spoken, voice: true }, notes: null, source: "service", sort_order: sort++,
        } as any);
        if (row) ids.push(row.id);
        continue;
      }
      const r = await addCatalogProductToQuote({
        addItem: d.addItem, product: l.product!, areaId, sortOrder: sort, quantity: l.quantity,
        bundles: d.bundles, templates: d.templates, liveProducts: d.products, source: "catalog",
        kitLengthM: (l.meta.kit_length_m as number) ?? null,
        qtyByCode: (l.meta.install_qty as Record<string, number>) ?? undefined,
      });
      sort += 1 + (r.kit ? 1 : 0) + r.installLines.length;
      for (const x of [r.line, r.kit, ...r.installLines]) if (x) ids.push(x.id);
      notes.push(...r.notes);
      if (!r.line) throw new Error(`Could not add ${l.label}.`);
    }
  }
  return { ids, notes };
}

/** Compact log payload: what each spoken item matched. */
export function planMatches(bd: SceneBreakdown) {
  return bd.areas.flatMap((a) => a.lines.map((l) => ({
    area: a.name, spoken: l.spoken, status: l.status, code: l.product?.product_code ?? null, label: l.label, qty: l.quantity,
    kit_length_m: l.meta.kit_length_m ?? null, install_qty: l.meta.install_qty ?? null,
  })));
}
