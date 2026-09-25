/**
 * Quote-scoped Mandy actions. Rendered inside <QuoteProvider> on the live
 * estimate page, so every action goes through QuoteContext exactly like the
 * on-screen controls. Unmounts (and unregisters) when the quote closes.
 */
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useQuoteLiveTotals } from "@/stores/quoteLiveTotalsStore";
import { useRegisterMandyActions } from "@/lib/mandy/registry";
import { fmtRand, type MandyResult } from "@/lib/mandy/actions";
import { addCatalogProductToQuote, kitLengthPatch, matchSpokenProduct } from "@/lib/mandy/quoteOps";
import { runSetLabourHours } from "@/lib/mandy/labourAction";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { standardLabourRate } from "@/lib/labour";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

interface Props {
  vatRate: number;
  /** May return a spoken message (e.g. builder hands PDF off to the estimate page). */
  onPdf: () => Promise<void | string>;
  onChanged?: () => void;
}

const lc = (s?: string | null) => (s || "").trim().toLowerCase();

export default function MandyQuoteActions({ vatRate, onPdf, onChanged }: Props) {
  const ctx = useQuoteContext();
  const { products } = useQuoteBuilderProducts();
  const { bundles } = useQuoteBuilderBundles();
  const { settings } = useCompanySettings();

  const nextSort = () => (ctx.items.length ? Math.max(...ctx.items.map((i) => i.sort_order || 0)) + 1 : 0);

  const findArea = (name?: string) => {
    if (!name) return ctx.areas.length === 1 ? ctx.areas[0] : null;
    const n = lc(name);
    return ctx.areas.find((a) => lc(a.name) === n) || ctx.areas.find((a) => lc(a.name).includes(n) || n.includes(lc(a.name))) || null;
  };

  const totals = () => {
    const live = useQuoteLiveTotals.getState();
    const top = ctx.items.filter((i) => !i.parent_item_id);
    const sub = live.hasLiveData
      ? live.subtotal
      : top.reduce((s, i) => s + (Number(i.total_price) || Number(i.quantity || 0) * Number(i.unit_price || 0)), 0);
    const dType = ctx.meta?.discount_type;
    const dVal = Number(ctx.meta?.discount_value || 0);
    const disc = dType === "percentage" || dType === "percent" ? (sub * dVal) / 100 : dType === "fixed" ? dVal : 0;
    const net = sub - disc;
    return { sub, disc, vat: net * vatRate, total: net * (1 + vatRate), lines: top.length };
  };

  const addProduct = async (p: PaletteProduct, areaName: string | undefined, qty: number): Promise<MandyResult> => {
    let area = findArea(areaName);
    if (!area && areaName) area = await ctx.addArea(areaName.trim());
    if (!area) area = ctx.areas[0] || (await ctx.ensureDefaultArea()) || (await ctx.addArea("Items"));
    if (!area) return { ok: false, message: "Could not find or create an area on this quote." };
    const r = await addCatalogProductToQuote({ addItem: ctx.addItem, product: p, areaId: area.id, sortOrder: nextSort(), quantity: qty, bundles, source: "mandy_voice" });
    if (!r.line) return { ok: false, message: `Could not add ${p.short_name || p.product_code}.` };
    onChanged?.();
    const kitTxt = r.kit ? `, with a 1 m ${r.kitName} at ${fmtRand(r.kitSellPerMetre || 0)} per metre excl. VAT` : "";
    return {
      ok: true,
      message: `Added ${qty > 1 ? `${qty} × ` : ""}${p.short_name} (${p.product_code}) to ${area.name} at ${fmtRand(r.unitSell)} excl. VAT${kitTxt}.`,
      data: { line_id: r.line.id, kit_id: r.kit?.id ?? null },
    };
  };

  useRegisterMandyActions({
    set_labour_hours: async (args) => {
      const r = await runSetLabourHours({
        areas: ctx.areas, items: ctx.items, standardRate: standardLabourRate(settings?.default_hourly_rate),
        addItem: ctx.addItem, updateItem: ctx.updateItem,
      }, args);
      if (r.ok && !r.choices) onChanged?.();
      return r;
    },
    add_area: async ({ name }) => {
      const n = String(name || "").trim();
      if (!n) return { ok: false, message: "No area name given." };
      const existing = findArea(n);
      if (existing && lc(existing.name) === lc(n)) return { ok: true, message: `${existing.name} already exists on this quote.` };
      const row = await ctx.addArea(n);
      onChanged?.();
      return row ? { ok: true, message: `Added area ${row.name}.` } : { ok: false, message: `Could not add area ${n}.` };
    },

    rename_area: async ({ area, new_name }) => {
      const a = findArea(area);
      if (!a) return { ok: false, message: `No area called ${area} on this quote.`, choices: ctx.areas.map((x) => ({ label: x.name, action: "rename_area", args: { area: x.name, new_name } })) };
      await ctx.updateArea(a.id, { name: String(new_name).trim() });
      onChanged?.();
      return { ok: true, message: `Renamed ${a.name} to ${new_name}.` };
    },

    add_item_to_area: async ({ area, query, quantity, product_id }) => {
      const qty = Number(quantity) > 0 ? Number(quantity) : 1;
      if (product_id) {
        const p = products.find((x) => x.id === product_id);
        if (!p) return { ok: false, message: "That product is no longer on the live catalog." };
        return addProduct(p, area, qty);
      }
      if (!products.length) return { ok: false, message: "The catalog is still loading — try again in a moment." };
      const m = matchSpokenProduct(String(query || ""), products);
      if (!m.ranked.length) return { ok: false, message: `Nothing on the live catalog matches “${query}”.` };
      if (m.tie) {
        return {
          ok: true,
          message: `Several products match “${query}”. Waiting for the user to tap one.`,
          choices: m.ranked.map((p) => ({
            label: `${p.short_name} · ${p.product_code}`,
            action: "add_item_to_area",
            args: { area, quantity: qty, product_id: p.id },
          })),
        };
      }
      return addProduct(m.ranked[0], area, qty);
    },

    set_kit_length: async ({ area, metres }) => {
      const m = Number(metres);
      if (!(m > 0)) return { ok: false, message: "Tell me how many metres." };
      const a = area ? findArea(area) : null;
      const kits = ctx.items.filter((i) => i.is_bundle && !i.parent_item_id && (!a || i.area_id === a.id) && (i.metadata as any)?.kit?.pricing_type !== "p/qty");
      if (!kits.length) return { ok: false, message: `No piping kit ${a ? `in ${a.name}` : "on this quote"}.` };
      if (kits.length > 1) {
        return {
          ok: true,
          message: "More than one kit on this quote. Waiting for the user to tap one.",
          choices: kits.map((k) => ({ label: `${k.item_name} · ${ctx.areas.find((x) => x.id === k.area_id)?.name || ""}`, action: "set_kit_length", args: { area: ctx.areas.find((x) => x.id === k.area_id)?.name, metres: m } })),
        };
      }
      const k = kits[0];
      const patch = kitLengthPatch(k, m);
      await ctx.updateItem(k.id, patch as any);
      onChanged?.();
      return { ok: true, message: `Set ${k.item_name} to ${patch.length} m — ${fmtRand(patch.unit_price)} excl. VAT.` };
    },

    remove_item: async ({ item }) => {
      const q = lc(item);
      const hits = ctx.items.filter((i) => !i.parent_item_id && (lc(i.item_name).includes(q) || lc(i.item_number) === q));
      if (!hits.length) return { ok: false, message: `No line matching “${item}”.` };
      if (hits.length > 1) {
        return { ok: true, message: "Several lines match. Waiting for the user to tap one.", choices: hits.slice(0, 5).map((h) => ({ label: `${h.item_name}${h.item_number ? ` · ${h.item_number}` : ""}`, action: "remove_item", args: { item: h.item_number || h.item_name } })) };
      }
      const h = hits[0];
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to remove ${h.item_name}.`,
        confirm: {
          summary: `Remove ${h.item_name} from the quote?`,
          run: async () => { await ctx.deleteItem(h.id); onChanged?.(); return { ok: true, message: `Removed ${h.item_name}.` }; },
        },
      };
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
  });

  return null;
}
