/**
 * Dry-run a Mandy plan against an in-memory copy of the open quote, using the
 * SAME shared functions the real handlers use (addCatalogProductToQuote with a
 * fake addItem, kitLengthPatch, runSetLabourHours, qtyPatch, linePriceDecision).
 * Nothing is saved. Produces the one Confirm card's lines and before → after.
 */
import { addCatalogProductToQuote, kitLengthPatch, matchSpokenProduct, type BundleForKit } from "@/lib/mandy/quoteOps";
import { runSetLabourHours } from "@/lib/mandy/labourAction";
import { matchQuoteItem, findUnitKits, qtyPatch, linePriceDecision, duplicateAreaRows, isKit, type EditItem, type EditArea, type PlanStep } from "@/lib/mandy/quoteEdits";
import type { CategoryMarkupRates } from "@/lib/pricing";

export interface PreviewDeps {
  items: EditItem[];
  areas: EditArea[];
  products: any[];
  bundles: BundleForKit[];
  rates: CategoryMarkupRates;
  standardRate: number | null;
  vatRate: number;
  discount?: { type?: string | null; value?: number | null };
}
export interface PreviewLine { step: number; action: string; label: string; qty: number | null; price: number | null }
export interface PlanPreview { lines: PreviewLine[]; before: number; after: number; beforeExcl: number; afterExcl: number; error?: string; errorStep?: number; pick?: { step: number; options: { id: string; label: string }[] } }

const lc = (s?: unknown) => String(s ?? "").trim().toLowerCase();
const lineTotal = (i: EditItem) => Number(i.total_price ?? Number(i.quantity || 0) * Number(i.unit_price || 0)) || 0;

export function quoteTotals(items: EditItem[], vatRate: number, discount?: PreviewDeps["discount"]) {
  const sub = items.filter((i) => !i.parent_item_id).reduce((s, i) => s + lineTotal(i), 0);
  const t = discount?.type, v = Number(discount?.value || 0);
  const disc = t === "percentage" || t === "percent" ? (sub * v) / 100 : t === "fixed" ? v : 0;
  const net = Math.max(0, sub - disc);
  return { excl: Number(net.toFixed(2)), incl: Number((net * (1 + vatRate)).toFixed(2)) };
}

export async function previewPlan(steps: PlanStep[], d: PreviewDeps): Promise<PlanPreview> {
  let items: EditItem[] = d.items.map((i) => ({ ...i, metadata: i.metadata ? { ...i.metadata } : i.metadata }));
  const areas: EditArea[] = d.areas.map((a) => ({ ...a }));
  let seq = 0;
  const newId = (p: string) => `__sim_${p}_${seq++}`;
  const findArea = (n?: unknown) => {
    const q = lc(n);
    if (!q) return areas.length === 1 ? areas[0] : null;
    return areas.find((a) => lc(a.name) === q) || areas.find((a) => lc(a.name).includes(q) || q.includes(lc(a.name))) || null;
  };
  const ensureArea = (n: unknown) => findArea(n) || (() => { const a = { id: newId("area"), name: String(n).trim() }; areas.push(a); return a; })();
  const addItem = async (row: any) => { const r = { ...row, id: newId("item") }; items.push(r); return r; };
  const updateItem = async (id: string, patch: any) => { items = items.map((i) => (i.id === id ? { ...i, ...patch } : i)); };
  const nextSort = () => (items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const before = quoteTotals(items, d.vatRate, d.discount);
  const lines: PreviewLine[] = [];
  const fail = (step: number, msg: string): PlanPreview => {
    const after = quoteTotals(items, d.vatRate, d.discount);
    return { lines, before: before.incl, after: after.incl, beforeExcl: before.excl, afterExcl: after.excl, error: msg, errorStep: step };
  };
  const one = (ref: unknown) => {
    const m = matchQuoteItem(items, areas, String(ref || ""));
    return m.hits.length === 1 ? m.hits[0] : null;
  };

  for (let n = 0; n < steps.length; n++) {
    const { action, args } = steps[n];
    const step = n + 1;
    switch (action) {
      case "add_area": { const a = ensureArea(args.name); lines.push({ step, action, label: `Area ${a.name}`, qty: null, price: null }); break; }
      case "add_item_to_area": {
        const qty = Number(args.quantity) > 0 ? Number(args.quantity) : 1;
        let p: any = null;
        if (args.product_id) p = d.products.find((x) => x.id === args.product_id);
        else {
          const m = matchSpokenProduct(String(args.query || ""), d.products);
          if (m.ranked.length && m.tie) {
            // Keep the whole plan pending: the user picks the model, then the card rebuilds.
            return { ...fail(step, `Which ${args.query}?`), pick: { step: n, options: m.ranked.map((x: any) => ({ id: x.id, label: `${x.short_name} · ${x.product_code}` })) } };
          }
          p = m.ranked[0] || null;
        }
        if (!p) return fail(step, `No single catalog match for “${args.query ?? ""}”.`);
        if (!args.area) return fail(step, `Which area for ${p.short_name}?`);
        const a = ensureArea(args.area);
        const r = await addCatalogProductToQuote({ addItem, product: p, areaId: a.id, sortOrder: nextSort(), quantity: qty, bundles: d.bundles });
        lines.push({ step, action, label: `${p.short_name} (${p.product_code}) → ${a.name}`, qty, price: Number(r.line?.unit_price) || 0 });
        if (r.kit) lines.push({ step, action: "auto_kit", label: `${r.kitName} (auto)`, qty: Number(r.kit.length) || 1, price: Number(r.kit.unit_price) || 0 });
        break;
      }
      case "set_kit_length": {
        const a = args.area ? findArea(args.area) : null;
        const kits = items.filter((i) => isKit(i) && !i.parent_item_id && (!a || i.area_id === a.id) && i.metadata?.kit?.pricing_type !== "p/qty");
        if (kits.length !== 1) return fail(step, kits.length ? "More than one kit — say which area." : "No piping kit there.");
        const p = kitLengthPatch(kits[0], Number(args.metres));
        await updateItem(kits[0].id, p);
        lines.push({ step, action, label: `${kits[0].item_name} length`, qty: p.length, price: p.unit_price });
        break;
      }
      case "set_labour_hours": {
        if (args.area && !findArea(args.area)) ensureArea(args.area);
        const r = await runSetLabourHours({ areas, items, standardRate: d.standardRate, addItem, updateItem }, args);
        if (!r.ok || r.choices) return fail(step, r.message);
        const a = findArea(args.area);
        const l = items.find((i) => i.area_id === a?.id && i.metadata?.labour);
        lines.push({ step, action, label: `Labour${a ? ` · ${a.name}` : ""}`, qty: Number(l?.quantity) || 0, price: Number(l?.total_price) || 0 });
        break;
      }
      case "set_qty": {
        const it = one(args.item);
        if (!it) return fail(step, `Which line is “${args.item}”?`);
        const p = qtyPatch(it, Number(args.qty), d.products.find((x) => x.id === it.product_id));
        await updateItem(it.id, p.patch);
        lines.push({ step, action, label: `${it.item_name} qty`, qty: p.value, price: Number(p.patch.unit_price ?? it.unit_price) });
        break;
      }
      case "set_line_price": {
        const it = one(args.item);
        if (!it) return fail(step, `Which line is “${args.item}”?`);
        const dcs = linePriceDecision(it, Number(args.price), d.rates);
        if (dcs.kind === "refuse") return fail(step, `${dcs.reason}${dcs.floor != null ? ` Floor is R${dcs.floor.toFixed(2)}.` : ""}`);
        await updateItem(it.id, dcs.patch);
        lines.push({ step, action, label: `${it.item_name} price${dcs.kind === "confirm" ? " (below list)" : ""}`, qty: Number(it.quantity) || 1, price: dcs.patch.unit_price });
        break;
      }
      case "remove_item": {
        const it = args.item_id ? items.find((i) => i.id === args.item_id) : one(args.item);
        if (!it) return fail(step, `Which line is “${args.item}”?`);
        const kits = args.with_kit === false ? [] : findUnitKits(items, it);
        const gone = new Set([it.id, ...kits.map((k) => k.id)]);
        items = items.filter((i) => !gone.has(i.id) && !gone.has(i.parent_item_id || ""));
        lines.push({ step, action, label: `Remove ${it.item_name}${kits.length ? " + kit" : ""}`, qty: null, price: -lineTotal(it) });
        break;
      }
      case "move_item": {
        const it = one(args.item);
        const a = findArea(args.area);
        if (!it || !a) return fail(step, !it ? `Which line is “${args.item}”?` : `No area called ${args.area}.`);
        for (const x of [it, ...findUnitKits(items, it)]) await updateItem(x.id, { area_id: a.id });
        lines.push({ step, action, label: `Move ${it.item_name} → ${a.name}`, qty: null, price: null });
        break;
      }
      case "duplicate_area": {
        const a = findArea(args.area);
        if (!a) return fail(step, `No area called ${args.area}.`);
        const na = ensureArea(args.new_name || `${a.name} copy`);
        const rows = duplicateAreaRows(items, a.id);
        for (const r of rows) await addItem({ ...r.row, area_id: na.id });
        lines.push({ step, action, label: `Duplicate ${a.name} → ${na.name}`, qty: rows.length, price: null });
        break;
      }
      case "remove_area": {
        const a = findArea(args.area);
        if (!a) return fail(step, `No area called ${args.area}.`);
        const gone = items.filter((i) => i.area_id === a.id);
        items = items.filter((i) => i.area_id !== a.id);
        areas.splice(areas.indexOf(a), 1);
        lines.push({ step, action, label: `Remove area ${a.name}${gone.length ? ` (${gone.length} lines)` : ""}`, qty: null, price: -gone.filter((i) => !i.parent_item_id).reduce((s, i) => s + lineTotal(i), 0) });
        break;
      }
      case "rename_area": case "describe_area": case "add_note": case "edit_note": case "remove_note": {
        lines.push({ step, action, label: action.replace(/_/g, " "), qty: null, price: null });
        break;
      }
      default:
        return fail(step, `${action.replace(/_/g, " ")} can't be part of a plan.`);
    }
  }
  const after = quoteTotals(items, d.vatRate, d.discount);
  return { lines, before: before.incl, after: after.incl, beforeExcl: before.excl, afterExcl: after.excl };
}
