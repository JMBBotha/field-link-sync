import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtHomeRand } from "@/lib/adminHomeCount";
import { materialBuyError, type MaterialBuy } from "@/lib/materialsPool";

export interface DeskLine { label: string; detail: string; valueLabel: string }
export interface DeskIntake {
  id: string;
  kind: "material_purchase" | "unit_purchase" | "return" | "direct_delivery";
  title: string;
  meta: string;
  amountLabel: string;
  review?: boolean;
}
export interface DeskAverage { id: string; label: string; per: "metre" | "install"; qty: string; unit: string }

const BLANK: MaterialBuy = { item: "", qty: "", unit: "m", total: "", date: "", supplier: "", docRef: "", used: "" };
type Filter = "all" | "purchases" | "returns" | "direct";

/** One screen for the materials pool: value on hand, a buy, already used, returns, and the averages WALDA may read. */
export function MaterialsDesk({
  totalLabel,
  lines,
  intakes,
  averages,
  onBuy,
  onUsed,
  onSaveAverage,
  onDeleteAverage,
}: {
  totalLabel: string;
  lines: DeskLine[];
  intakes: DeskIntake[];
  averages: DeskAverage[];
  onBuy?: (buy: MaterialBuy) => Promise<void>;
  onUsed?: (item: string, qty: string) => Promise<void>;
  onSaveAverage?: (row: DeskAverage) => Promise<void>;
  onDeleteAverage?: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [buy, setBuy] = useState<MaterialBuy>(BLANK);
  const [usedItem, setUsedItem] = useState("");
  const [usedQty, setUsedQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftAvg, setDraftAvg] = useState<DeskAverage>({ id: "", label: "", per: "install", qty: "", unit: "m" });
  const shown = intakes.filter((row) => {
    if (filter === "purchases") return row.kind === "material_purchase" || row.kind === "unit_purchase";
    if (filter === "returns") return row.kind === "return";
    if (filter === "direct") return row.kind === "direct_delivery";
    return true;
  });

  async function saveBuy() {
    const problem = materialBuyError(buy);
    if (problem) { setError(problem); return; }
    if (!onBuy) return;
    setError(null);
    try {
      await onBuy(buy);
      setBuy(BLANK);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that buy.");
    }
  }

  async function saveUsed() {
    if (!usedItem.trim() || !(Number(usedQty) > 0)) { setError("Say what was used, and how much."); return; }
    if (!onUsed) return;
    setError(null);
    try {
      await onUsed(usedItem, usedQty);
      setUsedQty("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    }
  }

  return (
    <section className="materials-desk" data-testid="materials-desk">
      <header className="materials-hero">
        <span>Materials pool</span>
        <b data-testid="materials-pool-value">{totalLabel}</b>
        <small>On hand, at cost. Units and direct deliveries are not in this figure.</small>
      </header>

      <ul className="materials-lines" data-testid="materials-lines">
        {lines.length === 0 && <li>Nothing in the pool yet.</li>}
        {lines.map((line) => (
          <li key={line.label}>
            <span><b>{line.label}</b><small>{line.detail}</small></span>
            <b>{line.valueLabel}</b>
          </li>
        ))}
      </ul>

      <h3>Load a buy</h3>
      <div className="materials-form" data-testid="materials-buy">
        <label>Item or category<input aria-label="Item or category" value={buy.item} placeholder="Copper pipe" onChange={(e) => setBuy({ ...buy, item: e.target.value })} /></label>
        <label>Quantity<input aria-label="Quantity" inputMode="decimal" value={buy.qty} onChange={(e) => setBuy({ ...buy, qty: e.target.value })} /></label>
        <label>Unit<input aria-label="Unit" value={buy.unit} onChange={(e) => setBuy({ ...buy, unit: e.target.value })} /></label>
        <label>Total cost<input aria-label="Total cost" inputMode="decimal" value={buy.total} placeholder="excl. VAT" onChange={(e) => setBuy({ ...buy, total: e.target.value })} /></label>
        <label>Date<input aria-label="Purchase date" type="date" value={buy.date} onChange={(e) => setBuy({ ...buy, date: e.target.value })} /></label>
        <label>Supplier<input aria-label="Supplier" value={buy.supplier} onChange={(e) => setBuy({ ...buy, supplier: e.target.value })} /></label>
        <label>Invoice ref<input aria-label="Invoice ref" value={buy.docRef} onChange={(e) => setBuy({ ...buy, docRef: e.target.value })} /></label>
        <label>Already used<input aria-label="Already used" inputMode="decimal" value={buy.used} placeholder="0" onChange={(e) => setBuy({ ...buy, used: e.target.value })} /></label>
        <button type="button" className="materials-save" data-testid="materials-save-buy" onClick={() => void saveBuy()}>Save this buy</button>
      </div>

      <h3>Already used</h3>
      <div className="materials-form materials-used" data-testid="materials-used">
        <label>Item<input aria-label="Used item" value={usedItem} placeholder="Cabling" onChange={(e) => setUsedItem(e.target.value)} /></label>
        <label>Quantity used<input aria-label="Used quantity" inputMode="decimal" value={usedQty} onChange={(e) => setUsedQty(e.target.value)} /></label>
        <button type="button" className="materials-save" data-testid="materials-save-used" onClick={() => void saveUsed()}>Record used</button>
      </div>
      {error && <p className="materials-error" data-testid="materials-error">{error}</p>}

      <div className="materials-filters" data-testid="materials-filters">
        {(["all", "purchases", "returns", "direct"] as const).map((key) => (
          <button key={key} type="button" data-testid={`materials-filter-${key}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {key === "all" ? "All" : key === "purchases" ? "Purchases" : key === "returns" ? "Returns / credits" : "Direct delivery"}
          </button>
        ))}
      </div>
      <ul className="materials-lines" data-testid="materials-intakes">
        {shown.length === 0 && <li>Nothing in this list.</li>}
        {shown.map((row) => (
          <li key={row.id} data-testid={`intake-${row.id}`}>
            <span>
              <b>{row.title}</b>
              <small>{row.meta}{row.review ? " · Check the model" : ""}</small>
            </span>
            <b>{row.amountLabel}</b>
          </li>
        ))}
      </ul>

      <h3>Standard averages</h3>
      <p className="materials-note">Per company. An admin edits these. WALDA can read them and cannot change them. Jobs are still costed from the pool average.</p>
      <ul className="materials-lines" data-testid="materials-averages">
        {averages.map((row) => (
          <li key={row.id}>
            <span><b>{row.label}</b><small>{row.qty} {row.unit} per {row.per === "metre" ? "metre" : "install"}</small></span>
            {onDeleteAverage && <button type="button" onClick={() => void onDeleteAverage(row.id)}>Remove</button>}
          </li>
        ))}
      </ul>
      <div className="materials-form" data-testid="materials-average-form">
        <label>Item<input aria-label="Average item" value={draftAvg.label} placeholder="Copper pipe" onChange={(e) => setDraftAvg({ ...draftAvg, label: e.target.value })} /></label>
        <label>Per
          <select aria-label="Per" value={draftAvg.per} onChange={(e) => setDraftAvg({ ...draftAvg, per: e.target.value as DeskAverage["per"] })}>
            <option value="install">Install</option>
            <option value="metre">Metre</option>
          </select>
        </label>
        <label>Quantity<input aria-label="Average quantity" inputMode="decimal" value={draftAvg.qty} onChange={(e) => setDraftAvg({ ...draftAvg, qty: e.target.value })} /></label>
        <label>Unit<input aria-label="Average unit" value={draftAvg.unit} onChange={(e) => setDraftAvg({ ...draftAvg, unit: e.target.value })} /></label>
        <button type="button" className="materials-save" data-testid="materials-save-average" onClick={() => {
          if (!draftAvg.label.trim() || !(Number(draftAvg.qty) >= 0)) { setError("Name the average and the quantity."); return; }
          if (!onSaveAverage) return;
          void onSaveAverage({ ...draftAvg, id: draftAvg.id || `new-${draftAvg.label}` }).then(() => setDraftAvg({ id: "", label: "", per: "install", qty: "", unit: "m" })).catch((err: Error) => setError(err.message));
        }}>Save average</button>
      </div>
      <style>{DESK_CSS}</style>
    </section>
  );
}

type HandPayload = { total?: number; lines?: { label?: string; qty?: number; unit?: string; value?: number }[] };
type IntakePayload = { id: string; kind: DeskIntake["kind"]; supplier_name?: string | null; doc_ref?: string | null; doc_date?: string | null; payment_status?: string | null; review_needed?: boolean; note?: string | null };

/** Live desk. A missing table or RPC leaves the form on screen and does not throw. */
export function MaterialsDeskLive({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const db = supabase as unknown as {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (table: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o?: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
        };
      };
    };
  };
  const q = useQuery({
    queryKey: ["materials-desk", companyId],
    queryFn: async () => {
      const [hand, intakes, averages] = await Promise.all([
        db.rpc("material_pool_on_hand"),
        db.from("stock_intakes").select("id, kind, supplier_name, doc_ref, doc_date, payment_status, review_needed, note").eq("company_id", companyId).order("doc_date", { ascending: false }),
        db.from("material_pool_averages").select("id, label, per, qty, unit").eq("company_id", companyId).order("label", { ascending: true }),
      ]);
      const body = (hand.data || {}) as HandPayload;
      return {
        total: hand.error || body.total == null ? null : Number(body.total),
        lines: (body.lines || []).map((line) => ({
          label: line.label || "Item",
          detail: `${line.qty ?? 0} ${line.unit || ""}`.trim(),
          valueLabel: fmtHomeRand(Number(line.value) || 0),
        })),
        intakes: ((intakes.data || []) as IntakePayload[]).map((row) => ({
          id: row.id,
          kind: row.kind,
          title: [row.supplier_name, row.doc_ref].filter(Boolean).join(" · ") || row.kind,
          meta: [row.doc_date, row.payment_status, row.note].filter(Boolean).join(" · "),
          amountLabel: "",
          review: !!row.review_needed,
        })),
        averages: ((averages.data || []) as { id: string; label: string; per: "metre" | "install"; qty: number; unit: string }[]).map((row) => ({
          id: row.id, label: row.label, per: row.per, qty: String(row.qty), unit: row.unit,
        })),
      };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["materials-desk", companyId] });
  const data = q.data;
  return (
    <MaterialsDesk
      totalLabel={data?.total == null ? "—" : fmtHomeRand(data.total)}
      lines={data?.lines || []}
      intakes={data?.intakes || []}
      averages={data?.averages || []}
      onBuy={async (buy) => {
        const { error } = await db.rpc("record_material_purchase", {
          p_item: buy.item.trim(),
          p_qty: Number(buy.qty),
          p_unit: buy.unit.trim(),
          p_total_cost: Number(buy.total),
          p_doc_date: buy.date,
          p_supplier: buy.supplier.trim() || null,
          p_doc_ref: buy.docRef.trim() || null,
          p_invoice_ref: buy.docRef.trim() || null,
          p_paid: false,
          p_already_used: buy.used.trim() === "" ? 0 : Number(buy.used),
          p_source_ref: `desk-${buy.docRef || buy.item}-${buy.date}-${buy.total}`,
        });
        if (error) throw new Error(/function|does not exist|schema/i.test(error.message || "") ? "The stock update is not on the database yet." : (error.message || "Could not save that buy."));
        await refresh();
      }}
      onUsed={async (item, qty) => {
        const { error } = await db.rpc("record_pool_used", { p_label: item.trim(), p_qty: Number(qty), p_note: "Already used" });
        if (error) throw new Error(error.message || "Could not record that.");
        await refresh();
      }}
      onSaveAverage={async (row) => {
        const { error } = await db.rpc("save_material_average", {
          p_id: row.id.startsWith("new-") ? null : row.id,
          p_label: row.label.trim(),
          p_per: row.per,
          p_qty: Number(row.qty),
          p_unit: row.unit.trim() || "m",
        });
        if (error) throw new Error(error.message || "Could not save that average.");
        await refresh();
      }}
      onDeleteAverage={async (id) => {
        const { error } = await db.rpc("delete_material_average", { p_id: id });
        if (error) throw new Error(error.message || "Could not remove that.");
        await refresh();
      }}
    />
  );
}

const DESK_CSS = `
.materials-desk { border-radius: 19px; padding: 12px; background: rgba(255,255,255,.86); color: #1d3a54; box-shadow: inset 0 0 0 1px rgba(186,214,236,.45); }
.materials-hero { background: #3D9BE8; color: #fff; border-radius: 14px; padding: 12px 14px; }
.materials-hero span, .materials-hero small { display: block; }
.materials-hero b { display: block; font-size: 32px; letter-spacing: -.4px; line-height: 1.1; }
.materials-hero small { opacity: .92; font-size: 12px; margin-top: 4px; }
.materials-desk h3 { margin: 14px 0 6px; font-size: 16px; }
.materials-lines { list-style: none; margin: 8px 0; padding: 0; }
.materials-lines li { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(140,180,210,.35); }
.materials-lines small { display: block; color: #4e6d86; font-size: 12px; }
.materials-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.materials-form label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 700; color: #4e6d86; }
.materials-form input, .materials-form select { min-height: 40px; border: 1px solid rgba(140,180,210,.8); border-radius: 8px; padding: 6px 8px; font-size: 14px; color: #1d3a54; background: #fff; }
.materials-save { min-height: 44px; grid-column: 1 / -1; border: 0; border-radius: 10px; background: #C2410C; color: #fff; font-weight: 700; }
.materials-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.materials-filters button { min-height: 36px; border-radius: 999px; border: 1px solid rgba(61,155,232,.55); background: #fff; color: #1d3a54; font-weight: 700; font-size: 12px; padding: 4px 10px; }
.materials-filters button[aria-pressed="true"] { background: #3D9BE8; color: #fff; border-color: #3D9BE8; }
.materials-note, .materials-error { font-size: 13px; }
.materials-error { color: #9a3412; font-weight: 700; }
.dark .materials-desk { background: rgba(10,22,38,.96); color: #f2f7fc; }
.dark .materials-lines small, .dark .materials-form label, .dark .materials-note { color: #d5e4f2; }
.dark .materials-form input, .dark .materials-form select, .dark .materials-filters button { background: #102033; color: #f2f7fc; border-color: rgba(186,214,236,.35); }
.dark .materials-filters button[aria-pressed="true"] { background: #3D9BE8; color: #fff; }
@media (max-width: 640px) { .materials-form { grid-template-columns: 1fr; } }
`;
