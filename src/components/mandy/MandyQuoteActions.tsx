/**
 * Quote-scoped Mandy actions. Rendered inside <QuoteProvider> on the live
 * estimate page AND the full builder, so every action goes through
 * QuoteContext exactly like the on-screen controls. Unmounts (and
 * unregisters) when the quote closes.
 *
 * Handlers read the quote through `live` (updated every render AND from each
 * refetch), so the steps of a multi-step plan see each other's writes.
 */
import { useQuoteContext } from "@/contexts/QuoteContext";
import { guardQuoteWrites, withWriteFailures } from "@/lib/mandy/writeGuard";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useQuoteLiveTotals } from "@/stores/quoteLiveTotalsStore";
import { useRegisterMandyActions } from "@/lib/mandy/registry";
import { getAssistantContext, setAssistantContext } from "@/stores/assistantContextStore";
import { isPronoun, resolveAreaPronoun, resolveItemPronoun, type TouchedCtx } from "@/lib/mandy/pronouns";
import { fmtRand, type MandyChoice, type MandyResult, type MandyHandler } from "@/lib/mandy/actions";
import { supabase } from "@/integrations/supabase/client";
import { captureSnapshot, stateHash, undoDecision, planRestore, saveUndoSnapshot, latestUnusedSnapshot, markSnapshotUsed } from "@/lib/mandy/undo";
import { addCatalogProductToQuote, addKitToQuote, areaUnitBtu, kitLengthPatch, isAirConditioningProduct } from "@/lib/mandy/quoteOps";
import { matchCatalog, catalogChipLabel } from "@/lib/mandy/catalogMatch";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";
import { runSetLabourHours, buildRemoveLabour, readLabour, labourSummary } from "@/lib/mandy/labourAction";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { standardLabourRate, findAreaLabour } from "@/lib/labour";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAfterMandyWrite } from "@/lib/mandy/verify";
import { setMandyQuoteStatus } from "@/lib/mandy/gate";
import {
  matchQuoteItem, findUnitKits, qtyPatch, linePriceDecision, duplicateAreaRows, isKit, isLabour,
  type EditItem, type PlanStep,
} from "@/lib/mandy/quoteEdits";
import { previewPlan } from "@/lib/mandy/planPreview";
import { resolveItemRef, findAreaFuzzy, noMatchMessage, chipLabel, isKitItem, isLabourRow } from "@/lib/mandy/itemResolve";
import { clearRefusal, clearSummary, areasToRemove, CLEARED_MESSAGE } from "@/lib/mandy/quoteIntent";
import { quoteLinesContext } from "@/lib/mandy/quoteLinesContext";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import { runInstallEdit, announceInstall, installContext, installLinesOf } from "@/lib/mandy/installEdits";
import type { QuoteArea, QuoteItem } from "@/types/quote";

interface Props {
  vatRate: number;
  /** May return a spoken message (e.g. builder hands PDF off to the estimate page). */
  onPdf: () => Promise<void | string>;
  onChanged?: () => void;
}

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
export const NEW_AREA_LABEL = "New area…";
/** Mandy writes that get an undo snapshot. */
export const UNDOABLE = new Set([
  "set_labour_hours", "add_area", "rename_area", "describe_area", "add_note", "add_item_to_area", "set_kit_length", "set_qty",
  "set_line_price", "move_item", "duplicate_area", "remove_item", "remove_labour", "remove_area", "remove_note", "edit_note", "clear_quote", "edit_install",
]);
/** "Added area X." → "added area X" (for "Undid added area X."). */
export const undoLabel = (msg: string) => { const m = String(msg || "").trim().replace(/[.!]+$/, ""); return m.charAt(0).toLowerCase() + m.slice(1); };

/** Pure: area chips (existing + "New area…") for an AC add with no area. */
/** AC units never default to an area: unless one was named and found, ask with chips. */
export function acNeedsAreaPick(isAc: boolean, area: unknown, spokenArea?: string): boolean {
  return isAc && !area && !String(spokenArea || "").trim();
}

export function areaChipsForAdd(areas: { name: string }[], args: Record<string, unknown>): MandyChoice[] {
  return [
    ...areas.map((a) => ({ label: a.name, action: "add_item_to_area", args: { ...args, area: a.name } })),
    { label: NEW_AREA_LABEL, action: "add_item_to_area", args: { ...args, area: `Area ${areas.length + 1}` } },
  ];
}

export interface NoteRef { key: string; target: "quote" | "area"; text: string; index?: number; areaId?: string; area?: string }
/** Pure: narrow notes by target and spoken words (area name or note text). */
export function filterNotes(notes: NoteRef[], target?: unknown, match?: unknown): NoteRef[] {
  const m = lc(String(match || ""));
  return notes.filter((n) => (!target || n.target === target) && (!m || lc(n.text).includes(m) || lc(n.area).includes(m)));
}

export default function MandyQuoteActions({ vatRate, onPdf, onChanged }: Props) {
  const ctx = useQuoteContext();
  // Write failures (null/false/throw) become WriteFailed → ok:false, never a success claim.
  const g = guardQuoteWrites(ctx);
  const { products } = useQuoteBuilderProducts();
  const { bundles } = useQuoteBuilderBundles();
  const { templates } = useInstallTemplates();
  const { settings } = useCompanySettings();
  const qc = useQueryClient();

  const live = useRef<{ areas: QuoteArea[]; items: QuoteItem[] }>({ areas: ctx.areas, items: ctx.items });
  live.current = { areas: ctx.areas, items: ctx.items };
  const S = () => live.current;

  // Mandy sees the real labour rows (area, hours, rate, total) with every turn.
  // …and the full quote (areas, every line, totals) so she can resolve references.
  const linesCtx = quoteLinesContext({ areas: ctx.areas, items: ctx.items as any[], subtotal: Number((ctx.meta as any)?.subtotal) || 0, total: Number((ctx.meta as any)?.total) || 0 });
  const instCtx = installContext(ctx.items as any[], (id) => ctx.areas.find((a) => a.id === id)?.name || "");
  useEffect(() => {
    setAssistantContext({ open_quote_lines: linesCtx, open_quote_labour: undefined, open_quote_install: instCtx || undefined });
    return () => setAssistantContext({ open_quote_lines: undefined, open_quote_install: undefined });
  }, [linesCtx, instCtx]);

  useEffect(() => {
    setMandyQuoteStatus(ctx.meta?.status ?? "draft");
    return () => setMandyQuoteStatus(null);
  }, [ctx.meta?.status]);

  /** After every write: invalidate this quote's caches + silently re-read QuoteContext. */
  const refresh = async () => {
    const fresh = await refreshAfterMandyWrite({
      refetch: ctx.refetch,
      invalidate: () => qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes(ctx.quoteId) }),
      onChanged,
    });
    if (fresh) live.current = { areas: fresh.areas, items: fresh.items };
    return fresh;
  };

  const nextSort = () => { const it = S().items; return it.length ? Math.max(...it.map((i) => i.sort_order || 0)) + 1 : 0; };

  const findArea = (name?: string) => {
    const areas = S().areas;
    if (!name) return areas.length === 1 ? areas[0] : null;
    return findAreaFuzzy(areas, name);
  };
  const areaName = (id: string | null) => S().areas.find((a) => a.id === id)?.name || "";
  const areaChips = (action: string, args: Record<string, unknown>) => S().areas.map((a) => ({ label: a.name, action, args: { ...args, area: a.name } }));

  /** Resolve a spoken line reference; ambiguous → chips re-running `action` with item_id. */
  const resolveItem = (ref: unknown, action: string, args: Record<string, unknown>): { item: QuoteItem } | { result: MandyResult } => {
    const pron = !args.item_id ? resolveItemPronoun(ref, getAssistantContext() as TouchedCtx) : null;
    if (pron) args = { ...args, item_id: pron };
    else if (isPronoun(ref)) return { result: { ok: false, message: "Which line do you mean?" } };
    if (args.item_id) {
      const it = S().items.find((i) => i.id === args.item_id);
      return it ? { item: it } : { result: { ok: false, message: "That line is no longer on the quote." } };
    }
    const m = resolveItemRef(S().items, S().areas, String(ref || ""));
    if (m.kind === "one") return { item: m.item };
    if (m.kind === "none") return { result: { ok: false, message: noMatchMessage(m.query, S().items, S().areas) } };
    return {
      result: {
        ok: true,
        message: `Which one? ${m.hits.slice(0, 6).map((h) => chipLabel(h, S().areas)).join(" / ")}. Waiting for the user to tap one.`,
        choices: m.hits.slice(0, 6).map((h) => ({ label: chipLabel(h, S().areas), action, args: { ...args, item_id: h.id } })),
      },
    };
  };

  const totals = () => {
    const liveT = useQuoteLiveTotals.getState();
    const top = S().items.filter((i) => !i.parent_item_id);
    const sub = liveT.hasLiveData
      ? liveT.subtotal
      : top.reduce((s, i) => s + (Number(i.total_price) || Number(i.quantity || 0) * Number(i.unit_price || 0)), 0);
    const dType = ctx.meta?.discount_type;
    const dVal = Number(ctx.meta?.discount_value || 0);
    const disc = dType === "percentage" || dType === "percent" ? (sub * dVal) / 100 : dType === "fixed" ? dVal : 0;
    const net = sub - disc;
    return { sub, disc, vat: net * vatRate, total: net * (1 + vatRate), lines: top.length };
  };

  const addProduct = async (p: PaletteProduct, areaNameArg: string | undefined, qty: number): Promise<MandyResult> => {
    let area = findArea(areaNameArg);
    if (!area && areaNameArg) area = await g.addArea(areaNameArg.trim());
    if (acNeedsAreaPick(isAirConditioningProduct(p), area, areaNameArg)) {
      return { ok: true, message: `Which area for ${p.short_name}? Waiting for the user to tap one.`, choices: areaChipsForAdd(S().areas, { product_id: p.id, quantity: qty }) };
    }
    if (!area) area = S().areas[0] || (await ctx.ensureDefaultArea()) || (await g.addArea("Items"));
    if (!area) return { ok: false, message: "Could not find or create an area on this quote." };
    const r = await addCatalogProductToQuote({ addItem: g.addItem, product: p, areaId: area.id, sortOrder: nextSort(), quantity: qty, bundles, templates, liveProducts: products, source: "mandy_voice" });
    if (!r.line) return { ok: false, message: `Could not add ${p.short_name || p.product_code}.` };
    const fresh = await refresh();
    const verified = !!fresh?.items.some((i) => i.id === r.line!.id) && (!r.kit || !!fresh?.items.some((i) => i.id === r.kit!.id))
      && r.installLines.every((l) => !!fresh?.items.some((i) => i.id === l.id));
    if (r.template || r.installLines.length || r.kit) {
      return { ok: true, message: announceInstall(`${qty > 1 ? `${qty} × ` : ""}${p.short_name}`, r as any, area.name), data: { line_id: r.line.id, kit_id: r.kit?.id ?? null, install_ids: r.installLines.map((l) => l.id), area: area.name }, verified };
    }
    const kitTxt = r.kit ? `, with a ${r.kitLength ?? 3} m ${r.kitName} at ${fmtRand(r.kitSellPerMetre || 0)} per metre excl. VAT` : "";
    return {
      ok: true,
      message: `Added ${qty > 1 ? `${qty} × ` : ""}${p.short_name} (${p.product_code}) to ${area.name} at ${fmtRand(r.unitSell)} excl. VAT${kitTxt}.${r.notes.length ? ` ${r.notes.join(". ")}.` : ""}`,
      data: { line_id: r.line.id, kit_id: r.kit?.id ?? null, area: area.name },
      verified,
    };
  };

  const doRemove = async (ids: string[], label: string): Promise<MandyResult> => {
    for (const id of ids) await g.deleteItem(id);
    const fresh = await refresh();
    return { ok: true, message: `Removed ${label}.`, verified: !!fresh && !fresh.items.some((i) => ids.includes(i.id)) };
  };

  const allNotes = (): NoteRef[] => [
    ...String(ctx.meta?.notes || "").split("\n").map((t, i) => ({ key: `quote:${i}`, target: "quote" as const, index: i, text: t.trim() })).filter((n) => n.text),
    ...S().areas.filter((a) => String(a.description || "").trim()).map((a) => ({ key: `area:${a.id}`, target: "area" as const, areaId: a.id, area: a.name, text: String(a.description).trim() })),
  ];
  const pickNote = (args: Record<string, any>, action: string): { note: NoteRef } | { result: MandyResult } => {
    const notes = allNotes();
    if (args.note_key) {
      const n = notes.find((x) => x.key === args.note_key);
      return n ? { note: n } : { result: { ok: false, message: "That note is no longer there." } };
    }
    const hits = filterNotes(notes, args.target, args.match);
    if (!hits.length) return { result: { ok: false, message: notes.length ? `No note matching “${args.match ?? ""}”.` : "There are no notes on this quote." } };
    if (hits.length === 1) return { note: hits[0] };
    return { result: { ok: true, message: "Several notes. Waiting for the user to tap one.", choices: hits.slice(0, 8).map((n) => ({ label: `${n.area ? `${n.area}: ` : "Quote: "}${n.text.slice(0, 40)}`, action, args: { ...args, note_key: n.key } })) } };
  };
  const writeNote = async (n: NoteRef, text: string | null) => {
    if (n.target === "area") { await g.updateArea(n.areaId!, { description: text } as any); return; }
    const parts = String(ctx.meta?.notes || "").split("\n");
    if (text == null) parts.splice(n.index!, 1); else parts[n.index!] = text;
    await ctx.updateQuote({ notes: parts.filter((p) => p.trim()).join("\n") || null } as any);
  };

  /** Authoritative quote state straight from the database (for snapshots and the undo hash). */
  const readState = async () => {
    const [q, a, i] = await Promise.all([
      supabase.from("quotes").select("notes, subtotal, vat_amount, total, updated_at").eq("id", ctx.quoteId).single(),
      supabase.from("quote_areas").select("*").eq("quote_id", ctx.quoteId),
      supabase.from("quote_items").select("*").eq("quote_id", ctx.quoteId),
    ]);
    const meta = (q.data || {}) as any;
    return { meta, areas: (a.data || []) as any[], items: (i.data || []) as any[], snapshot: captureSnapshot(meta, (a.data || []) as any[], (i.data || []) as any[]) };
  };
  type State = Awaited<ReturnType<typeof readState>>;
  const pendingPlanSnap = useRef<State | null>(null);
  const recordUndo = async (action: string, label: string, before: State) => {
    const after = await readState();
    const hashAfter = stateHash(after.meta.notes, after.areas, after.items);
    if (hashAfter === stateHash(before.meta.notes, before.areas, before.items)) return; // nothing changed
    await saveUndoSnapshot({ quoteId: ctx.quoteId, action, label: undoLabel(label), snapshot: before.snapshot, hashAfter, quoteUpdatedAtAfter: after.meta.updated_at });
  };
  const isDone = (r: MandyResult) => r.ok && !r.choices?.length && !r.confirm;
  /** Snapshot before every Mandy write (plan steps are covered by the plan-level snapshot). */
  const wrapWithUndo = (hs: Record<string, MandyHandler>): Record<string, MandyHandler> =>
    Object.fromEntries(Object.entries(hs).map(([name, h]) => [name, !UNDOABLE.has(name) ? h : async (args) => {
      if (args.__plan || (ctx.meta?.status && ctx.meta.status !== "draft")) return h(args);
      const before = await readState();
      const r = await h(args);
      if (r.confirm) {
        const run = r.confirm.run;
        return { ...r, confirm: { ...r.confirm, run: async () => {
          const b2 = await readState(); const res = await run();
          if (isDone(res)) await recordUndo(name, res.message, b2);
          return res;
        } } };
      }
      if (isDone(r)) await recordUndo(name, r.message, before);
      return r;
    }]));

  const splitArea = (ref: string) => { const m = ref.match(/\b(?:in|from|on|off)\s+(?:the\s+)?(.+)$/i); return m ? m[1] : undefined; };
  const handlers: Record<string, MandyHandler> = {
    /** Internal (no schema → never offered to the model): force-refresh the open quote. */
    __refresh_quote: async () => {
      const fresh = await refresh();
      return { ok: !!fresh, message: fresh ? "Refreshed." : "Could not refresh.", verified: !!fresh };
    },
    /** Internal: dry-run a plan with the shared pricing; nothing is saved. */
    __preview_plan: async ({ steps }) => {
      const preview = await previewPlan((steps as PlanStep[]) || [], {
        items: S().items as EditItem[], areas: S().areas, products, bundles, rates: ctx.markupRates,
        standardRate: standardLabourRate(settings?.default_hourly_rate), vatRate,
        discount: { type: ctx.meta?.discount_type, value: Number(ctx.meta?.discount_value || 0) },
      });
      return { ok: true, message: preview.error || "Preview ready.", data: { preview } };
    },

    set_labour_hours: async (args) => {
      const r = await runSetLabourHours({
        areas: S().areas, items: S().items, standardRate: standardLabourRate(settings?.default_hourly_rate),
        addItem: g.addItem, updateItem: g.updateItem,
      }, args);
      if (!r.ok || r.choices) return r;
      const fresh = await refresh();
      const a = fresh?.areas.find((x) => lc(x.name) === lc(String(args.area || ""))) || (fresh?.areas.length === 1 ? fresh.areas[0] : null);
      return { ...r, verified: !!a && !!fresh && !!findAreaLabour(fresh.items as any[], a.id) };
    },

    remove_labour: async (args) => {
      if (ctx.meta?.status && ctx.meta.status !== "draft") return { ok: false, message: `This quote is ${ctx.meta.status}, so it's read-only.` };
      const r = buildRemoveLabour({ areas: S().areas, items: S().items, deleteItem: g.deleteItem }, args, async () => { await refresh(); });
      if (args.__plan && r.confirm) return r.confirm.run();
      return r;
    },

    edit_install: async (args) => {
      if (ctx.meta?.status && ctx.meta.status !== "draft") return { ok: false, message: `This quote is ${ctx.meta.status}, so it's read-only.` };
      const r = await runInstallEdit({
        items: S().items as any[], areaName: (id) => areaName(id ?? null), liveProducts: products,
        addItem: g.addItem, updateItem: g.updateItem, deleteItem: g.deleteItem, bundles: bundles as any, after: async () => { await refresh(); },
      }, args as any);
      if (args.__plan && r.confirm) return r.confirm.run();
      return r;
    },

    read_labour: async () => readLabour({ areas: S().areas, items: S().items }),

    add_area: async ({ name }) => {
      const n = String(name || "").trim();
      if (!n) return { ok: false, message: "No area name given." };
      const existing = findArea(n);
      if (existing && lc(existing.name) === lc(n)) return { ok: true, message: `${existing.name} already exists on this quote.` };
      const row = await g.addArea(n);
      if (!row) return { ok: false, message: `Could not add area ${n}.` };
      const fresh = await refresh();
      return { ok: true, message: `Added area ${row.name}.`, verified: !!fresh?.areas.some((x) => x.id === row.id) };
    },

    rename_area: async ({ area, new_name, name }) => {
      const a = findArea(area);
      const nn = String(new_name ?? name ?? "").trim();
      if (!a) return { ok: false, message: `No area called ${area} on this quote.`, choices: areaChips("rename_area", { new_name: nn }) };
      if (!nn) return { ok: false, message: "What should the new name be?" };
      await g.updateArea(a.id, { name: nn });
      const fresh = await refresh();
      return { ok: true, message: `Renamed ${a.name} to ${nn}.`, verified: !!fresh?.areas.some((x) => x.id === a.id && x.name === nn) };
    },

    describe_area: async ({ area, description }) => {
      const a = findArea(area);
      if (!a) return { ok: false, message: `No area called ${area} on this quote.`, choices: areaChips("describe_area", { description }) };
      const d = String(description || "").trim();
      await g.updateArea(a.id, { description: d } as any);
      const fresh = await refresh();
      return { ok: true, message: `Described ${a.name}: ${d}.`, verified: !!fresh?.areas.some((x: any) => x.id === a.id && x.description === d) };
    },

    add_note: async (args) => {
      const text = String(args.text || "").trim();
      if (!text) return { ok: false, message: "What should the note say?" };
      if (args.target === "item") {
        const r = resolveItem(args.item, "add_note", args);
        if ("result" in r) return r.result;
        const notes = [r.item.notes, text].filter(Boolean).join("\n");
        await g.updateItem(r.item.id, { notes });
        const fresh = await refresh();
        return { ok: true, message: `Added a note to ${r.item.item_name}.`, verified: !!fresh?.items.some((i) => i.id === r.item.id && i.notes === notes) };
      }
      const notes = [ctx.meta?.notes, text].filter(Boolean).join("\n");
      await ctx.updateQuote({ notes });
      await refresh();
      return { ok: true, message: "Added a note to the quote." };
    },

    add_item_to_area: async ({ area, query, quantity, product_id }) => {
      const qty = Number(quantity) > 0 ? Number(quantity) : 1;
      if (product_id) {
        const p = products.find((x) => x.id === product_id);
        if (!p) return { ok: false, message: "That product is no longer on the live catalog." };
        return addProduct(p, area, qty);
      }
      if (!products.length) return { ok: false, message: "The catalog is still loading — try again in a moment." };
      const area0 = findArea(area);
      const m = matchCatalog(String(query || ""), products as any[], bundles as any, { areaBtu: areaUnitBtu(S().items, products, area0?.id) });
      if (!m.ranked.length) return { ok: false, message: `Nothing on the live catalog matches “${query}”.` };
      if (m.pick?.kind === "kit") {
        if (!area0) return { ok: true, message: `Which area for the ${m.pick.kit.name}? Waiting for the user to tap one.`, choices: areaChips("add_item_to_area", { query }) };
        const k = await addKitToQuote({ addItem: g.addItem, bundle: m.pick.kit as any, areaId: area0.id, sortOrder: nextSort(), source: "mandy_voice" });
        if (!k.kit) return { ok: false, message: `Could not add ${m.pick.kit.name}.` };
        const fresh = await refresh();
        return { ok: true, message: `Added ${k.kitName} to ${area0.name} at ${fmtRand(Number(k.kit.unit_price))} excl. VAT.`, data: { line_id: k.kit.id, area: area0.name }, verified: !!fresh?.items.some((i) => i.id === k.kit!.id) };
      }
      if (!m.pick) {
        return {
          ok: true,
          message: `Several products match “${query}”. Waiting for the user to tap one.`,
          choices: m.options.map((h: any) => h.kind === "kit"
            ? { label: catalogChipLabel(h), action: "add_item_to_area", args: { area, query: h.kit.name } }
            : { label: catalogChipLabel(h, getEffectiveUnitPrices(h.product).unitSell), action: "add_item_to_area", args: { area, quantity: qty, product_id: h.id } }),
        };
      }
      return addProduct(m.pick.product as PaletteProduct, area, qty);
    },

    set_kit_length: async (args) => {
      let { area, kit_id } = args;
      const m = Number(args.metres);
      if (!(m > 0)) return { ok: false, message: "Tell me how many metres." };
      if (args.item && !kit_id) {
        const r = resolveItem(args.item, "set_kit_length", args);
        if ("result" in r) return r.result;
        if (!isKitItem(r.item)) return { ok: false, message: `${r.item.item_name} isn't a kit — nothing was changed.` };
        kit_id = r.item.id; area = undefined;
      }
      const a = area && !kit_id ? findArea(area) : null;
      const kits = kit_id
        ? S().items.filter((i) => i.id === kit_id)
        : S().items.filter((i) => i.is_bundle && !i.parent_item_id && (!a || i.area_id === a.id) && (i.metadata as any)?.kit?.pricing_type !== "p/qty");
      if (!kits.length) return { ok: false, message: `No piping kit ${a ? `in ${a.name}` : "on this quote"}.` };
      if (kits.length > 1) {
        return {
          ok: true,
          message: "More than one kit on this quote. Waiting for the user to tap one.",
          choices: kits.map((k) => ({ label: `${k.item_name} · ${areaName(k.area_id)}`, action: "set_kit_length", args: { area: areaName(k.area_id), metres: m } })),
        };
      }
      const k = kits[0];
      const patch = kitLengthPatch(k, m);
      await g.updateItem(k.id, patch as any);
      const fresh = await refresh();
      const row = fresh?.items.find((i) => i.id === k.id);
      return { ok: true, message: `Set ${k.item_name} to ${patch.length} m — ${fmtRand(patch.unit_price)} excl. VAT.`, verified: !!row && Number(row.length) === Number(patch.length) };
    },

    set_qty: async (args) => {
      const r = resolveItem(args.item, "set_qty", args);
      if ("result" in r) return r.result;
      const it = r.item;
      const p = qtyPatch(it as EditItem, Number(args.qty), products.find((x) => x.id === it.product_id) as any);
      await g.updateItem(it.id, p.patch as any);
      const fresh = await refresh();
      const unit = p.kind === "length" ? " m" : p.kind === "hours" ? " h" : "";
      const row = fresh?.items.find((i) => i.id === it.id);
      return {
        ok: true,
        message: `${it.item_name}: ${p.value}${unit}, ${fmtRand(Number(p.patch.total_price ?? p.patch.unit_price ?? 0))} excl. VAT.`,
        verified: !!row && (p.kind === "length" ? Number(row.length) === p.value : Number(row.quantity) === p.value),
      };
    },

    set_line_price: async (args) => {
      const r = resolveItem(args.item, "set_line_price", args);
      if ("result" in r) return r.result;
      const it = r.item;
      const d = linePriceDecision(it as EditItem, Number(args.price), ctx.markupRates);
      if (d.kind === "refuse") {
        return { ok: false, message: `${d.reason}${d.floor != null ? ` The lowest allowed is ${fmtRand(d.floor)} excl. VAT.` : ""} Nothing changed.`, data: { floor: d.floor } };
      }
      const apply = async (): Promise<MandyResult> => {
        await g.updateItem(it.id, d.patch as any);
        const fresh = await refresh();
        return { ok: true, message: `${it.item_name} now ${fmtRand(d.patch.unit_price)} excl. VAT.`, verified: !!fresh?.items.some((i) => i.id === it.id && Number(i.unit_price) === d.patch.unit_price) };
      };
      if (d.kind === "confirm" && !args.__plan) {
        return {
          ok: true,
          message: `Awaiting on-screen confirmation: ${fmtRand(d.patch.unit_price)} is below list ${fmtRand(d.list)}.`,
          confirm: { summary: `Set ${it.item_name} to ${fmtRand(d.patch.unit_price)} excl. VAT (list ${fmtRand(d.list)}, floor ${fmtRand(d.floor)})?`, run: apply },
        };
      }
      return apply();
    },

    move_item: async (args) => {
      const r = resolveItem(args.item, "move_item", args);
      if ("result" in r) return r.result;
      const target = resolveAreaPronoun(args.area, getAssistantContext() as TouchedCtx);
      const a = findArea(target);
      if (!a) return { ok: false, message: target ? `No area called ${target}.` : "Which area should it move to?", choices: areaChips("move_item", { item_id: r.item.id }) };
      const fromArea = areaName(r.item.area_id);
      const moving = [r.item, ...findUnitKits(S().items as EditItem[], r.item as EditItem)];
      for (const x of moving) await g.moveItemToArea(x.id, a.id);
      const fresh = await refresh();
      return {
        ok: true,
        message: `Moved ${r.item.item_name}${moving.length > 1 ? " and its kit" : ""} to ${a.name}.`,
        data: { item_id: r.item.id, area: a.name, from_area: fromArea },
        verified: !!fresh && moving.every((x) => fresh.items.some((i) => i.id === x.id && i.area_id === a.id)),
      };
    },

    duplicate_area: async ({ area, new_name }) => {
      const a = findArea(area);
      if (!a) return { ok: false, message: `No area called ${area} on this quote.`, choices: areaChips("duplicate_area", { new_name }) };
      const nn = String(new_name || `${a.name} copy`).trim();
      const na = await g.addArea(nn);
      if (!na) return { ok: false, message: `Could not add area ${nn}.` };
      const idMap = new Map<string, string>();
      const rows = duplicateAreaRows(S().items as EditItem[], a.id);
      let sort = nextSort();
      for (const r of rows) {
        const created = await g.addItem({ ...(r.row as any), area_id: na.id, parent_item_id: r.parentSrcId ? idMap.get(r.parentSrcId) ?? null : null, sort_order: sort++ });
        if (created) idMap.set(r.srcId, created.id);
      }
      const fresh = await refresh();
      return { ok: true, message: `Copied ${a.name} to ${na.name} — ${rows.length} lines at the same prices.`, verified: !!fresh?.areas.some((x) => x.id === na.id) };
    },

    remove_item: async (args) => {
      // "remove bedroom one" names an area, not a line → remove_area (its own Confirm card).
      const areaRef = String(args.item || "").replace(/^(the|my)\s+/i, "").replace(/\s+(area|room)$/i, "");
      if (!args.item_id && areaRef && findAreaFuzzy(S().areas, areaRef) && !/\b(kit|unit|samsung|labou?r)\b/i.test(areaRef)
        && resolveItemRef(S().items, S().areas, areaRef).kind !== "one") {
        return handlers.remove_area({ ...args, area: areaRef });
      }
      if (!args.item_id && /^\s*(the\s+)?labou?r\b/i.test(String(args.item || ""))) {
        return handlers.remove_labour({ area: splitArea(String(args.item)) });
      }
      const r = resolveItem(args.item, "remove_item", args);
      if ("result" in r) return r.result;
      const h = r.item;
      const kits = findUnitKits(S().items as EditItem[], h as EditItem);
      const inst = installLinesOf(S().items as any[], h.id);
      const ids = inst.length
        ? [h.id, ...(args.with_kit === false ? [] : inst.map((k) => k.id))]
        : [h.id, ...(args.with_kit === false ? [] : kits.map((k) => k.id))];
      const hasKit = inst.some((l) => (l.metadata as any)?.install?.role === "piping_kit");
      const others = inst.length - (hasKit ? 1 : 0);
      const label = inst.length && ids.length > 1
        ? `${h.item_name} and its install (${[hasKit ? "kit" : "", others ? `${others} line${others > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ")})`
        : `${h.item_name}${ids.length > 1 ? " and its kit" : ""}`;
      if (args.__plan) return doRemove(ids, label); // the plan's single Confirm already covered it
      const where = areaName(h.area_id);
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to remove ${label}${where ? ` from ${where}` : ""}.`,
        confirm: {
          summary: `Remove ${label}${where ? ` from ${where}` : ""}?`,
          lines: S().items.filter((i) => ids.includes(i.id)).map((i) => `${i.item_name} · ${fmtRand(Number(i.total_price) || 0)}`),
          run: () => doRemove(ids, label),
        },
        // A unit with a kit: one tap to keep the kit instead.
        ...((kits.length || inst.length) && args.with_kit === undefined ? { choices: [{ label: inst.length ? "Remove unit only" : "Remove unit only (keep kit)", action: "remove_item", args: { item_id: h.id, with_kit: false } }] } : {}),
      };
    },

    remove_area: async (args) => {
      if (ctx.meta?.status && ctx.meta.status !== "draft") return { ok: false, message: `This quote is ${ctx.meta.status}, so it's read-only.` };
      const a = findArea(args.area);
      if (!a || !args.area) return { ok: false, message: args.area ? `No area called ${args.area}.` : "Which area?", choices: areaChips("remove_area", {}) };
      const lines = S().items.filter((i) => i.area_id === a.id);
      const run = async (): Promise<MandyResult> => {
        for (const i of lines.filter((x) => x.parent_item_id)) await g.deleteItem(i.id);
        for (const i of lines.filter((x) => !x.parent_item_id)) await g.deleteItem(i.id);
        await g.deleteArea(a.id);
        const fresh = await refresh();
        return { ok: true, message: `Removed area ${a.name}${lines.length ? ` and its ${lines.length} lines` : ""}.`, verified: !!fresh && !fresh.areas.some((x) => x.id === a.id) };
      };
      if (!lines.length || args.__plan) return run();
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to remove ${a.name} and its lines.`,
        confirm: {
          summary: `Remove ${a.name} and its ${lines.filter((l) => !l.parent_item_id).length} line${lines.filter((l) => !l.parent_item_id).length === 1 ? "" : "s"}?`,
          lines: lines.filter((l) => !l.parent_item_id).map((l) => `${l.item_name} · ${fmtRand(Number(l.total_price) || 0)}`),
          run,
        } as any,
      };
    },

    clear_quote: async (args) => {
      const qn = ctx.meta?.quote_number || "this quote";
      const { data: invs } = await supabase.from("invoices").select("status").eq("quote_id", ctx.quoteId);
      const { count: jobs } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("quote_id", ctx.quoteId);
      const refusal = clearRefusal(qn, ctx.meta?.status, {
        depositPaid: (invs || []).some((i: any) => /paid/i.test(String(i.status))), hasJob: (jobs || 0) > 0,
      });
      if (refusal) return { ok: false, message: refusal };
      const top = S().items.filter((i) => !i.parent_item_id);
      const dropAreas = args.include_areas ? areasToRemove(S().areas) : [];
      const counts = { items: top.filter((i) => !isKitItem(i) && !isLabourRow(i)).length, labour: top.filter(isLabourRow).length, kits: top.filter(isKitItem).length, areasRemoved: dropAreas.length };
      if (!top.length && !dropAreas.length) return { ok: true, message: `${qn} is already empty.` };
      const run = async (): Promise<MandyResult> => {
        // ONE batch delete: every line (kit children cascade/are included), then the extra rooms.
        const del = await supabase.from("quote_items").delete().eq("quote_id", ctx.quoteId).select("id");
        if (del.error || (del.data?.length ?? 0) === 0) return { ok: false, message: "Couldn't clear the quote — nothing was changed." };
        if (dropAreas.length) {
          const da = await supabase.from("quote_areas").delete().in("id", dropAreas).select("id");
          if (da.error) { await refresh(); return { ok: false, message: "Cleared the lines but couldn't remove the rooms. Say undo to bring everything back." }; }
        }
        const fresh = await refresh();
        return { ok: true, message: dropAreas.length ? "Cleared the quote and its rooms, R0. Say undo to bring it back." : CLEARED_MESSAGE, verified: !!fresh && fresh.items.length === 0 };
      };
      if (args.__plan) return run();
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to clear ${qn}.`,
        confirm: { summary: clearSummary(qn, counts), danger: true, lines: top.map((i) => `${i.item_name} · ${areaName(i.area_id) || "No area"} · ${fmtRand(Number(i.total_price) || 0)}`), run } as any,
      };
    },

    remove_note: async (args) => {
      const r = pickNote(args, "remove_note");
      if ("result" in r) return r.result;
      const n = r.note;
      const run = async () => { await writeNote(n, null); await refresh(); return { ok: true, message: `Removed the note “${n.text}”.` } as MandyResult; };
      if (args.__plan) return run();
      return { ok: true, message: "Awaiting on-screen confirmation to remove the note.", confirm: { summary: `Remove note: “${n.text}”?`, run } };
    },

    edit_note: async (args) => {
      const text = String(args.text || "").trim();
      if (!text) return { ok: false, message: "What should the note say?" };
      const r = pickNote(args, "edit_note");
      if ("result" in r) return r.result;
      await writeNote(r.note, text);
      await refresh();
      return { ok: true, message: `Changed the note to “${text}”.` };
    },

    generate_quote_pdf: async () => {
      const m = await onPdf();
      if (typeof m === "string") return { ok: true, message: m };
      return { ok: true, message: `Generated the PDF for ${ctx.meta?.quote_number || "this quote"}.` };
    },

    read_quote_total: async () => {
      const t = totals();
      return {
        ok: true,
        message: `${ctx.meta?.quote_number || "Quote"}: ${t.lines} lines, ${fmtRand(t.sub)} excl. VAT${t.disc ? `, discount ${fmtRand(t.disc)}` : ""}, VAT ${fmtRand(t.vat)}, total ${fmtRand(t.total)} incl. VAT.`,
        data: { subtotal: t.sub, total: t.total },
      };
    },
    /** Internal: plan-level snapshot (the dock calls begin before Confirm runs, commit after). */
    __begin_undo: async () => { pendingPlanSnap.current = await readState(); return { ok: true, message: "" }; },
    __commit_undo: async ({ label }) => {
      const before = pendingPlanSnap.current; pendingPlanSnap.current = null;
      if (before) await recordUndo("run_plan", String(label || "the plan"), before);
      return { ok: true, message: "" };
    },

    undo_last_change: async () => {
      const status = ctx.meta?.status ?? "draft";
      const snap = status === "draft" ? await latestUnusedSnapshot(ctx.quoteId) : null;
      const cur = await readState();
      const d = undoDecision({ status, snap, currentHash: stateHash(cur.meta.notes, cur.areas, cur.items) });
      if (d.ok === false) return { ok: false, message: d.message };
      const beforeTotal = Number(cur.meta.total) || 0;
      const plan = planRestore(snap!.snapshot, { notes: cur.meta.notes, areas: cur.areas, items: cur.items });
      // Builder save path: delete extras, re-insert / update rows as they were (same ids).
      for (const id of plan.deleteItems) await g.deleteItem(id);
      for (const a of plan.insertAreas) await supabase.from("quote_areas").insert({ ...a, quote_id: ctx.quoteId } as any);
      for (const a of plan.updateAreas) await g.updateArea(a.id, { name: a.name, description: a.description, sort_order: a.sort_order } as any);
      for (const i of plan.insertItems) await g.addItem(i as any);
      for (const i of plan.updateItems) { const { id, ...patch } = i; await g.updateItem(id, patch as any); }
      for (const id of plan.deleteAreas) await g.deleteArea(id);
      if (plan.notesChanged) await ctx.updateQuote({ notes: snap!.snapshot.quote.notes } as any);
      await markSnapshotUsed(snap!.id);
      await refresh(); // totals are recomputed by the shared quote-items trigger
      const after = await readState();
      return {
        ok: true,
        message: `Undid ${snap!.label || snap!.action.replace(/_/g, " ")}. Total ${fmtRand(beforeTotal)} → ${fmtRand(Number(after.meta.total) || 0)} incl. VAT.`,
        verified: stateHash(after.meta.notes, after.areas, after.items) === stateHash(snap!.snapshot.quote.notes, snap!.snapshot.areas, snap!.snapshot.items),
      };
    },
  };

  useRegisterMandyActions(wrapWithUndo(withWriteFailures(handlers)));
  return null;
}

// Re-exported for tests.
export { isKit, isLabour };
