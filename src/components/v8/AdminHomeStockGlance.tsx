import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TEST_HVAC_ID } from "@/lib/adminHomeCashFlow";
import {
  STOCK_RULE, buildStockGlance, formatQty,
  type StockAllowance, type StockCandle, type StockGlance, type StockItemRow, type StockJob, type StockMove, type StockQuoteLine,
} from "@/lib/adminHomeStockGlance";
import { AdminHomeGlanceSheet, InfoMark, type GlanceModel } from "./AdminHomeGlanceSheet";

const db = supabase as any;

function CandleBar({ row }: { row: StockCandle }) {
  const scale = Math.max(row.onHand, row.needed, row.minimum ?? 0, 0.001);
  const hand = Math.min(100, (row.onHand / scale) * 100);
  const need = Math.min(100, (row.needed / scale) * 100);
  const minPct = row.minimum == null ? null : Math.min(100, (row.minimum / scale) * 100);
  const short = row.needed > row.onHand;
  return (
    <div className="relative h-3.5 rounded-full bg-[#EEF3F8]" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 rounded-full bg-[#7CC4F4]" style={{ width: `${hand}%` }} />
      {short && <div className="absolute inset-y-0 rounded-full bg-[#FDBA8C]" style={{ left: `${hand}%`, width: `${Math.max(need - hand, 0)}%` }} />}
      <div className="absolute -top-0.5 bottom-[-2px] w-[2px] rounded bg-[#E8A06A]" style={{ left: `calc(${need}% - 1px)` }} />
      {minPct != null && <div className="absolute -top-1 bottom-[-3px] w-[2px] rounded bg-[#C4B5FD]" style={{ left: `calc(${minPct}% - 1px)` }} />}
    </div>
  );
}

function lossText(row: StockCandle): string | null {
  if (!row.loss) return null;
  const bits: string[] = [];
  if (row.loss.expected > 0 || row.loss.actual > 0) {
    const diff = row.loss.variance;
    bits.push(`Estimate: finished jobs were lined up for ${formatQty(row.loss.expected, row.unit)}; movements show ${formatQty(row.loss.actual, row.unit)} used${diff === 0 ? "" : ` (about ${formatQty(Math.abs(diff), row.unit)} ${diff > 0 ? "more" : "less"})`}.`);
  }
  if (row.loss.countGap != null && row.loss.countGap !== 0) {
    const n = row.loss.countGap;
    bits.push(`Last count was about ${formatQty(Math.abs(n), row.unit)} ${n < 0 ? "under" : "over"} the books.`);
  }
  return bits.length ? bits.join(" ") : null;
}

export function stockModels(g: StockGlance): { all: GlanceModel; loss: GlanceModel; gaps: GlanceModel; item: (row: StockCandle) => GlanceModel } {
  const rows = g.candles.map((c) => ({
    id: c.key,
    label: c.label,
    detail: `On hand ${formatQty(c.onHand, c.unit)} · needed ${formatQty(c.needed, c.unit)} · ${c.minimum == null ? "no minimum set" : `minimum ${formatQty(c.minimum, c.unit)}`}${lossText(c) ? ` · ${lossText(c)}` : ""}`,
    amountText: formatQty(c.onHand, c.unit),
    href: c.href,
    links: [
      { href: c.href, text: "Stock" },
      ...c.jobs.slice(0, 6).map((j) => ({ href: j.href, text: j.label })),
    ],
  }));
  return {
    all: { title: "Stock on hand", rule: `${STOCK_RULE} ${g.onHandNote}`, rows, totalText: `${g.candles.length} item${g.candles.length === 1 ? "" : "s"}`, actionLabel: "Open stock count", actionHref: "/admin/stock-count" },
    loss: {
      title: "Loss estimate",
      rule: "For pipe, lagging, cable, brackets and other small items only. Expected is what finished jobs’ lines said to use. Actual is what stock movements show was used. The difference is an estimate of offcuts and losses, not a barcode count. A stock count, when there is one, is the shelf versus the books.",
      rows: g.candles.filter((c) => c.loss).map((c) => ({
        id: c.key, label: c.label,
        detail: lossText(c) || "No loss figure yet.",
        amountText: c.loss ? formatQty(c.loss.variance, c.unit) : "—",
        href: c.href,
      })),
      totalText: "Estimate",
      actionLabel: "Open stock count",
      actionHref: "/admin/stock-count",
    },
    gaps: {
      title: "Run length not on the job",
      rule: "These jobs name pipe, a kit, lagging or cable but do not say how long the run is. Nothing was filled in as 10 m, and a unit size was not turned into a pipe list.",
      rows: g.gaps.map((gap) => ({ id: gap.id, label: gap.label, detail: gap.detail, amountText: "Not counted", href: gap.href })),
      totalText: `${g.gaps.length}`,
      actionLabel: "Open jobs",
      actionHref: "/admin/jobs",
    },
    item: (row) => ({
      title: row.label,
      rule: `${STOCK_RULE} ${g.onHandNote}`,
      rows: row.jobs.length ? row.jobs.map((j) => ({ id: j.jobId, label: j.label, detail: j.note || "Still to draw", amountText: formatQty(j.qty, row.unit), href: j.href })) : [{ id: row.key, label: row.label, detail: `On hand ${formatQty(row.onHand, row.unit)}${row.minimum == null ? " · no minimum set" : ` · minimum ${formatQty(row.minimum, row.unit)}`}`, amountText: formatQty(row.onHand, row.unit), href: row.href }],
      totalText: `Needed ${formatQty(row.needed, row.unit)}`,
      actionLabel: "Open stock count",
      actionHref: "/admin/stock-count",
    }),
  };
}

export function StockGlanceCard({
  glance, loading, error, openFirst, minimumsAvailable, onSetMinimum,
}: {
  glance: StockGlance | null;
  loading?: boolean;
  error?: boolean;
  openFirst?: boolean;
  minimumsAvailable?: boolean;
  onSetMinimum?: (id: string, value: number | null) => Promise<string | null>;
}) {
  const [open, setOpen] = useState<GlanceModel | null>(null);
  const [minNote, setMinNote] = useState<string | null>(null);
  const models = useMemo(() => (glance ? stockModels(glance) : null), [glance]);
  useEffect(() => { if (openFirst && models) setOpen(models.all); }, [openFirst, models]);
  const visible = glance?.candles.slice(0, 8) || [];
  return (
    <section data-testid="admin-stock-glance" className="rounded-2xl border bg-card p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-sm">Stock · on hand and jobs</b>
        <span className="inline-flex items-center text-xs font-semibold text-[#1590d6]">
          <button type="button" onClick={() => models && setOpen(models.all)}>How counted</button>
          <InfoMark label="How the stock glance was counted" onClick={() => models && setOpen(models.all)} />
        </span>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading stock…</p>}
      {error && <p className="text-sm text-muted-foreground">Couldn’t load stock for this company.</p>}
      {glance && !loading && !error && (
        <>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><i className="h-[9px] w-[9px] rounded-[2px] bg-[#7CC4F4]" /> On hand</span>
            <span className="inline-flex items-center gap-1"><i className="h-[9px] w-[9px] rounded-[2px] bg-[#FDBA8C]" /> Still to draw</span>
            <span className="inline-flex items-center gap-1"><i className="h-[9px] w-[2px] bg-[#C4B5FD]" /> Minimum</span>
          </div>
          {visible.length === 0 && <p className="text-sm text-muted-foreground">No stock on hand and no materials on upcoming jobs.</p>}
          <ul className="space-y-2.5">
            {visible.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => models && setOpen(models.item(row))} className="w-full text-left">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate font-semibold">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatQty(row.onHand, row.unit)} / {formatQty(row.needed, row.unit)}</span>
                  </div>
                  <CandleBar row={row} />
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{row.minimum == null ? "No minimum set" : `Minimum ${formatQty(row.minimum, row.unit)}`}</span>
                    {row.jobs[0] && <Link to={row.jobs[0].href} className="text-[#1478C8] underline" onClick={(e) => e.stopPropagation()}>{row.jobs[0].label}</Link>}
                  </div>
                </button>
                {row.small && lossText(row) && <p className="mt-0.5 text-[11px] leading-snug text-[#5B6B7F]">{lossText(row)}</p>}
                {minimumsAvailable && onSetMinimum && row.stockItemId && (
                  <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    Minimum
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      defaultValue={row.minimum ?? ""}
                      placeholder="not set"
                      aria-label={`Minimum for ${row.label}`}
                      className="h-8 w-24 rounded-lg border bg-white px-2 text-sm text-[#0F1B2A]"
                      onBlur={async (e) => {
                        const raw = e.target.value.trim();
                        const value = raw === "" ? null : Number(raw);
                        if (value != null && !Number.isFinite(value)) return;
                        const err = await onSetMinimum(row.stockItemId!, value);
                        setMinNote(err);
                      }}
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>
          {glance.candles.length > visible.length && <button type="button" className="mt-2 text-xs font-semibold text-[#1590d6]" onClick={() => models && setOpen(models.all)}>{glance.candles.length - visible.length} more</button>}
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-[#1590d6]">
            <button type="button" onClick={() => models && setOpen(models.loss)}>Loss estimate</button>
            {glance.gaps.length > 0 && <button type="button" data-testid="stock-missing-length" onClick={() => models && setOpen(models.gaps)}>{glance.gaps.length} without a run length</button>}
          </div>
          {minNote && <p className="mt-1 text-[11px] text-muted-foreground">{minNote}</p>}
        </>
      )}
      {open && <AdminHomeGlanceSheet model={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

async function inChunks<T>(ids: string[], run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    if (slice.length) out.push(...await run(slice));
  }
  return out;
}

function customerName(row: { customers?: { name?: string | null } | { name?: string | null }[] | null }): string | null {
  const c = row.customers;
  const name = Array.isArray(c) ? c[0]?.name : c?.name;
  return name || null;
}

async function loadStock(companyId: string): Promise<{ glance: StockGlance; minimumsAvailable: boolean }> {
  let minimumsAvailable = true;
  let itemRes = await db.from("cf_stock_items").select("id, company_id, item, product_id, stock_unit, qty_on_hand, active, min_on_hand").eq("company_id", companyId).eq("active", true).limit(2000);
  if (itemRes.error && /min_on_hand/i.test(String(itemRes.error.message || ""))) {
    minimumsAvailable = false;
    itemRes = await db.from("cf_stock_items").select("id, company_id, item, product_id, stock_unit, qty_on_hand, active").eq("company_id", companyId).eq("active", true).limit(2000);
  }
  if (itemRes.error) throw itemRes.error;
  const [jobsRes, allowRes, moveRes] = await Promise.all([
    db.from("jobs").select("id, company_id, title, status, quote_id, invoice_id, job_type, customers(name)").eq("company_id", companyId).not("status", "in", "(cancelled,canceled)").limit(400),
    db.from("material_allowances").select("id, company_id, job_type, unit_size, item_label, stock_unit, qty, product_id, active, effective_from, effective_to").eq("company_id", companyId),
    db.from("stock_movements").select("company_id, stock_item_id, product_id, job_id, bucket, kind, qty, item_label").eq("company_id", companyId).limit(5000),
  ]);
  if (jobsRes.error) throw jobsRes.error;
  if (allowRes.error) throw allowRes.error;
  if (moveRes.error) throw moveRes.error;
  const jobs = ((jobsRes.data || []) as any[]).map((j): StockJob => ({
    id: j.id, company_id: j.company_id, title: j.title, status: j.status, quote_id: j.quote_id, invoice_id: j.invoice_id, job_type: j.job_type, customer_name: customerName(j),
  }));
  const quoteIds = [...new Set(jobs.map((j) => j.quote_id).filter(Boolean))] as string[];
  const quoteRows = quoteIds.length ? await inChunks(quoteIds, async (slice) => {
    const r = await db.from("quote_items").select("id, quote_id, item_name, description, item_type, item_number, quantity, length, product_id, is_bundle, parent_item_id, price_per_unit_label, metadata").in("quote_id", slice);
    if (r.error) throw r.error;
    return r.data || [];
  }) : [];
  const productIds = [...new Set((quoteRows as any[]).map((r) => r.product_id).filter(Boolean))] as string[];
  const products = productIds.length ? await inChunks(productIds, async (slice) => {
    const r = await db.from("supplier_products").select("id, product_code, short_name, product_category, category, product_type, pipe_liquid, pipe_gas, sold_in_length, unit_length, price_per_unit_label, suppliers(supplier_type)").in("id", slice);
    if (r.error) throw r.error;
    return r.data || [];
  }) : [];
  const productById = new Map((products as any[]).map((p) => [p.id, p]));
  const lines: StockQuoteLine[] = (quoteRows as any[]).map((row) => {
    const p = row.product_id ? productById.get(row.product_id) : undefined;
    const supplier = Array.isArray(p?.suppliers) ? p.suppliers[0] : p?.suppliers;
    return {
      id: row.id, quote_id: row.quote_id, item_name: row.item_name, description: row.description, item_type: row.item_type, item_number: row.item_number,
      quantity: row.quantity, length: row.length, product_id: row.product_id, is_bundle: row.is_bundle, parent_item_id: row.parent_item_id,
      price_per_unit_label: row.price_per_unit_label || p?.price_per_unit_label, metadata: row.metadata,
      product_category: p?.product_category, category: p?.category, product_code: p?.product_code || row.item_number, supplier_type: supplier?.supplier_type,
      product_type: p?.product_type, pipe_liquid: p?.pipe_liquid, pipe_gas: p?.pipe_gas, sold_in_length: p?.sold_in_length, unit_length: p?.unit_length, short_name: p?.short_name,
    };
  });
  const countRes = await db.from("stock_counts").select("id").eq("company_id", companyId).eq("status", "posted").order("counted_on", { ascending: false }).limit(1);
  let counts: { company_id: string; stock_item_id: string; system_qty: number; counted_qty: number }[] = [];
  if (!countRes.error && countRes.data?.[0]?.id) {
    const linesRes = await db.from("stock_count_lines").select("stock_item_id, system_qty, counted_qty, company_id").eq("count_id", countRes.data[0].id);
    if (!linesRes.error) counts = linesRes.data || [];
  }
  const items: StockItemRow[] = ((itemRes.data || []) as any[]).map((s) => ({
    id: s.id, company_id: s.company_id, label: s.item, product_id: s.product_id, unit: s.stock_unit, cache_on_hand: s.qty_on_hand, minimum: minimumsAvailable ? s.min_on_hand : null,
  }));
  const glance = buildStockGlance({
    companyId,
    jobs,
    lines,
    allowances: (allowRes.data || []) as StockAllowance[],
    items,
    moves: (moveRes.data || []) as StockMove[],
    counts,
  });
  return { glance, minimumsAvailable };
}

export function useAdminHomeStock() {
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ["caller-company-id"], staleTime: 300_000, queryFn: async () => ((await db.rpc("caller_company_id")).data as string | null) ?? null });
  const companyId = company.data ?? null;
  const q = useQuery({
    queryKey: ["admin-home-stock-glance", companyId],
    enabled: !!companyId && companyId !== TEST_HVAC_ID,
    refetchInterval: 60_000,
    queryFn: () => loadStock(companyId!),
  });
  const setMinimum = async (id: string, value: number | null) => {
    if (!companyId) return "No company.";
    const res = await db.from("cf_stock_items").update({ min_on_hand: value }).eq("id", id).eq("company_id", companyId);
    if (res.error) return "Minimum could not be saved. It stays blank until the stock list has a minimum column.";
    await qc.invalidateQueries({ queryKey: ["admin-home-stock-glance", companyId] });
    return null;
  };
  return {
    glance: q.data?.glance ?? null,
    minimumsAvailable: q.data?.minimumsAvailable ?? false,
    loading: company.isLoading || (!!companyId && companyId !== TEST_HVAC_ID && q.isLoading),
    error: q.isError,
    setMinimum,
  };
}

export default function AdminHomeStockGlance() {
  const { glance, loading, error, minimumsAvailable, setMinimum } = useAdminHomeStock();
  return <StockGlanceCard glance={glance} loading={loading} error={error} minimumsAvailable={minimumsAvailable} onSetMinimum={setMinimum} />;
}
