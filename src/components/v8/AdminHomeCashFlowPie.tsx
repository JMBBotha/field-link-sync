import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCreditNotes } from "@/lib/creditNotes";
import {
  CASH_RULES, TEST_HVAC_ID, countCashFlow, formatMoney,
  type CashCommitment, type CashCredit, type CashFlowGlance, type CashFlowLine, type CashInvoice, type CashLineInput, type CashPayment, type CashPoLine, type CashProductCost,
} from "@/lib/adminHomeCashFlow";
import { AdminHomeGlanceSheet, InfoMark, type GlanceModel, type GlanceRow } from "./AdminHomeGlanceSheet";

const COLOURS = { money: "#7CC4F4", liability: "#FDBA8C", finals: "#86D9B5" } as const;

function centreRand(n: number): string {
  const sign = n < -0.5 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}R${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${sign}R${Math.round(abs / 1000)}k`;
  return `${sign}R${Math.round(abs)}`;
}

function Donut({ parts, center, sub, onSlice }: { parts: { key: string; value: number; colour: string }[]; center: string; sub: string; onSlice: (key: string) => void }) {
  const sum = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  let acc = 0;
  const live = parts.filter((p) => p.value > 0);
  return (
    <svg viewBox="0 0 42 42" className="h-[124px] w-[124px] shrink-0" role="img" aria-label={`${center} ${sub}`}>
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF3F8" strokeWidth="7" />
      {sum > 0 && parts.map((p) => {
        if (!(p.value > 0)) return null;
        const pct = (p.value / sum) * 100;
        const dash = Math.max(pct - (live.length > 1 ? 0.6 : 0), 0.4);
        const offset = 25 - acc;
        acc += pct;
        return (
          <circle key={p.key} cx="21" cy="21" r="15.915" fill="none" stroke={p.colour} strokeWidth="7"
            strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={offset} className="cursor-pointer" onClick={() => onSlice(p.key)}>
            <title>{p.key}</title>
          </circle>
        );
      })}
      <text x="21" y="19.4" textAnchor="middle" fill="#0F1B2A" fontSize={center.length > 6 ? 4.2 : 5.2} fontWeight="800">{center}</text>
      <text x="21" y="24.4" textAnchor="middle" fill="#5B6B7F" fontSize="2.7">net cover</text>
    </svg>
  );
}

function rowOf(line: CashFlowLine, amountText: string): GlanceRow {
  const links = [{ href: line.href, text: line.label.split(" · ")[0] || "Invoice" }];
  if (line.jobHref) links.push({ href: line.jobHref, text: line.jobLabel || "Job" });
  return {
    id: line.id,
    label: line.label.includes(" · ") ? line.label.split(" · ").slice(1).join(" · ") : line.label,
    detail: line.detail,
    amountText,
    href: line.href,
    links,
  };
}

export function cashModels(g: CashFlowGlance): Record<"money" | "liability" | "finals" | "cover", GlanceModel> {
  const uncosted = g.uncostedUnits > 0 ? ` ${g.uncostedUnits} unit${g.uncostedUnits === 1 ? "" : "s"} have no supplier price and ${g.uncostedUnits === 1 ? "is" : "are"} listed as uncosted, not guessed.` : "";
  const coverRows: GlanceRow[] = g.moneyLines.map((money) => {
    const fin = g.finalLines.find((l) => l.invoiceId === money.invoiceId);
    const units = g.liabilityLines.filter((l) => l.invoiceId === money.invoiceId);
    const liab = units.reduce((s, l) => s + l.amount, 0);
    const missing = units.filter((l) => l.uncosted).length;
    return {
      ...rowOf(money, formatMoney(money.amount + (fin?.amount || 0) - liab)),
      detail: `In ${formatMoney(money.amount)} · still to come ${formatMoney(fin?.amount || 0)} · units to buy ${formatMoney(liab)}${missing ? ` · ${missing} uncosted` : ""}`,
    };
  });
  return {
    money: { title: "Money in", rule: CASH_RULES.money, rows: g.moneyLines.map((l) => rowOf(l, formatMoney(l.amount))), totalText: formatMoney(g.moneyIn), actionLabel: "Open invoices", actionHref: "/admin/invoices" },
    liability: { title: "Units still to order", rule: CASH_RULES.liability + uncosted, rows: g.liabilityLines.map((l) => rowOf(l, l.uncosted ? "Uncosted" : formatMoney(l.amount))), totalText: formatMoney(g.liability), actionLabel: "Open invoices", actionHref: "/admin/invoices" },
    finals: { title: "Expected finals", rule: CASH_RULES.finals, rows: g.finalLines.map((l) => rowOf(l, formatMoney(l.amount))), totalText: formatMoney(g.expectedFinals), actionLabel: "Open invoices", actionHref: "/admin/invoices" },
    cover: { title: "Net cover", rule: CASH_RULES.cover + uncosted, rows: coverRows, totalText: formatMoney(g.netCover), actionLabel: "Open invoices", actionHref: "/admin/invoices" },
  };
}

export function CashFlowPieCard({ glance, loading, error, openFirst }: { glance: CashFlowGlance | null; loading?: boolean; error?: boolean; openFirst?: boolean }) {
  const [open, setOpen] = useState<GlanceModel | null>(null);
  const models = useMemo(() => (glance ? cashModels(glance) : null), [glance]);
  useEffect(() => { if (openFirst && models) setOpen(models.money); }, [openFirst, models]);
  const show = (key: "money" | "liability" | "finals" | "cover") => { if (models) setOpen(models[key]); };
  return (
    <section data-testid="admin-cash-flow-pie" className="rounded-2xl border bg-card p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-sm">Deposit jobs · cash glance</b>
        <span className="inline-flex items-center text-xs font-semibold text-[#1590d6]">
          <button type="button" onClick={() => show("cover")}>incl. VAT</button>
          <InfoMark label="How the cash glance was counted" onClick={() => show("cover")} />
        </span>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading cash flow…</p>}
      {error && <p className="text-sm text-muted-foreground">Couldn’t load cash flow for this company.</p>}
      {glance && !loading && !error && (
        <>
          <div className="flex flex-col items-stretch gap-3 min-[480px]:flex-row min-[480px]:items-center">
            <button type="button" className="mx-auto shrink-0" onClick={() => show("cover")} aria-label="Net cover">
              <Donut
                parts={[
                  { key: "money", value: glance.moneyIn, colour: COLOURS.money },
                  { key: "liability", value: glance.liability, colour: COLOURS.liability },
                  { key: "finals", value: glance.expectedFinals, colour: COLOURS.finals },
                ]}
                center={centreRand(glance.netCover)}
                sub="net cover"
                onSlice={(key) => show(key === "money" || key === "liability" || key === "finals" ? key : "cover")}
              />
            </button>
            <div className="min-w-0 flex-1">
              {([
                ["money", "Money in", glance.moneyIn, COLOURS.money],
                ["liability", "Units still to buy", glance.liability, COLOURS.liability],
                ["finals", "Still to come", glance.expectedFinals, COLOURS.finals],
              ] as const).map(([key, label, value, colour]) => (
                <button key={key} type="button" onClick={() => show(key)} className="flex w-full items-center gap-2 border-b border-[#F0F3F7] py-1.5 text-left text-[12.5px] last:border-b-0">
                  <i className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: colour }} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <b className="shrink-0 tabular-nums">{formatMoney(value)}</b>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Net cover is money in, plus what’s still to come, minus units still to buy. A glance, not one accounting total.{glance.uncostedUnits > 0 ? ` ${glance.uncostedUnits} unit${glance.uncostedUnits === 1 ? "" : "s"} uncosted.` : ""}</p>
          <div className="mt-2" data-testid="cash-flow-when">
            <div className="text-xs font-bold">When the rest is expected</div>
            {glance.when.length === 0 && <p className="py-1 text-xs text-muted-foreground">{glance.invoices === 0 ? "No sent invoices with a deposit in." : "Nothing still to come."}</p>}
            {glance.when.slice(0, 4).map((g) => (
              <div key={g.key} className="border-t py-1.5 first:border-t-0">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={g.key === "unset" ? "font-bold" : "font-semibold"}>{g.label}</span>
                  <span className="tabular-nums">{formatMoney(g.total)}</span>
                </div>
                {g.lines.slice(0, 3).map((l) => (
                  <div key={l.id} className="flex flex-wrap gap-x-2 text-[11px]">
                    <Link to={l.href} className="text-[#1478C8] underline">{l.label.split(" · ")[0]}</Link>
                    {l.jobHref && <Link to={l.jobHref} className="text-[#1478C8] underline">{l.jobLabel || "Job"}</Link>}
                    <span className="text-muted-foreground">{l.label.split(" · ").slice(1).join(" · ")}</span>
                  </div>
                ))}
              </div>
            ))}
            {glance.when.length > 4 && <button type="button" className="text-xs font-semibold text-[#1590d6]" onClick={() => show("finals")}>All dates</button>}
          </div>
        </>
      )}
      {open && <AdminHomeGlanceSheet model={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

const db = supabase as any;

async function inChunks<T>(ids: string[], run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    if (slice.length) out.push(...await run(slice));
  }
  return out;
}

function supplierType(row: { suppliers?: { supplier_type?: string | null } | { supplier_type?: string | null }[] | null }): string | null {
  const s = row.suppliers;
  if (Array.isArray(s)) return s[0]?.supplier_type ?? null;
  return s?.supplier_type ?? null;
}

async function loadCashFlow(companyId: string): Promise<CashFlowGlance> {
  const invRes = await db.from("invoices").select("id, company_id, status, grand_total, invoice_number, customer_name, expected_final_date, sent_at, archived_at, quote_id, line_items").eq("company_id", companyId).limit(2000);
  if (invRes.error) throw invRes.error;
  const invoices = (invRes.data || []) as CashInvoice[];
  const ids = invoices.map((i) => i.id);
  const quoteIds = [...new Set(invoices.map((i) => i.quote_id).filter(Boolean))] as string[];
  const [payments, credits, itemRows, quoteRows, jobByInvoice, jobByQuote] = await Promise.all([
    ids.length ? inChunks(ids, async (slice) => { const r = await db.from("payments").select("id, invoice_id, company_id, amount, status, gateway").in("invoice_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    fetchCreditNotes(ids),
    ids.length ? inChunks(ids, async (slice) => { const r = await db.from("invoice_items").select("id, invoice_id, line_name, description, line_type, product_id, quantity, service_id").in("invoice_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    quoteIds.length ? inChunks(quoteIds, async (slice) => { const r = await db.from("quote_items").select("id, quote_id, item_name, description, item_type, item_number, quantity, product_id, is_bundle, metadata").in("quote_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    ids.length ? inChunks(ids, async (slice) => { const r = await db.from("jobs").select("id, company_id, invoice_id, quote_id, title").eq("company_id", companyId).in("invoice_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    quoteIds.length ? inChunks(quoteIds, async (slice) => { const r = await db.from("jobs").select("id, company_id, invoice_id, quote_id, title").eq("company_id", companyId).in("quote_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
  ]);
  const productIds = [...new Set([...(itemRows as any[]), ...(quoteRows as any[])].map((r) => r.product_id).filter(Boolean))] as string[];
  const products = productIds.length ? await inChunks(productIds, async (slice) => {
    const r = await db.from("supplier_products").select("id, cost_excl_vat, cost_incl_vat, vat_rate, product_code, product_category, category, product_type, suppliers(supplier_type)").in("id", slice);
    if (r.error) throw r.error;
    return r.data || [];
  }) : [];
  const productById = new Map((products as any[]).map((p) => [p.id, p]));
  const [commitments, pos] = await Promise.all([
    ids.length ? inChunks(ids, async (slice) => { const r = await db.from("cf_commitments").select("id, company_id, invoice_id, item, kind, qty, status").eq("company_id", companyId).in("invoice_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    ids.length ? inChunks(ids, async (slice) => { const r = await db.from("purchase_orders").select("id, invoice_id, company_id, status").eq("company_id", companyId).in("invoice_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
  ]);
  const commitIds = (commitments as any[]).map((c) => c.id);
  const poIds = (pos as any[]).map((p) => p.id);
  const [allocations, poItems] = await Promise.all([
    commitIds.length ? inChunks(commitIds, async (slice) => { const r = await db.from("cf_stock_allocations").select("commitment_id, qty, company_id").in("commitment_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
    poIds.length ? inChunks(poIds, async (slice) => { const r = await db.from("purchase_order_items").select("id, po_id, description, model_code, unit_cost_excl_vat, qty").in("po_id", slice); if (r.error) throw r.error; return r.data || []; }) : Promise.resolve([]),
  ]);
  const poById = new Map((pos as any[]).map((p) => [p.id, p]));
  const jobs = [...(jobByInvoice as any[]), ...(jobByQuote as any[])];
  const jobFor = (inv: CashInvoice) => jobs.find((j) => j.invoice_id === inv.id) || jobs.find((j) => inv.quote_id && j.quote_id === inv.quote_id);
  const paint = (row: any, name: string): CashLineInput => {
    const p = row.product_id ? productById.get(row.product_id) : undefined;
    return {
      id: row.id, name, description: row.description, quantity: row.quantity, line_type: row.line_type || row.item_type,
      service_id: row.service_id, product_id: row.product_id, quote_category: row.metadata?.quote_category, is_bundle: row.is_bundle,
      product_code: row.item_number || p?.product_code, product_category: p?.product_category, category: p?.category, supplier_type: supplierType(p || {}),
    };
  };
  const linesByInvoice: Record<string, CashLineInput[]> = {};
  for (const row of itemRows as any[]) {
    const list = linesByInvoice[row.invoice_id] || [];
    list.push(paint(row, row.line_name || row.description || "Line"));
    linesByInvoice[row.invoice_id] = list;
  }
  for (const inv of invoices) {
    if (linesByInvoice[inv.id]?.length) continue;
    const json = Array.isArray((inv as any).line_items) ? (inv as any).line_items : [];
    linesByInvoice[inv.id] = json.map((row: any, i: number) => paint({ ...row, id: `${inv.id}:${i}` }, row.name || row.description || "Line"));
  }
  const quoteLinesByQuote: Record<string, CashLineInput[]> = {};
  for (const row of quoteRows as any[]) {
    const list = quoteLinesByQuote[row.quote_id] || [];
    list.push(paint(row, row.item_name || "Line"));
    quoteLinesByQuote[row.quote_id] = list;
  }
  const withJobs = invoices.map((inv) => {
    const job = jobFor(inv);
    return job ? { ...inv, job_id: job.id, job_label: job.title || "Job" } : inv;
  });
  const poLines: CashPoLine[] = (poItems as any[]).map((item) => {
    const po = poById.get(item.po_id);
    return { id: item.id, invoice_id: po?.invoice_id, company_id: po?.company_id, status: po?.status, description: item.description, model_code: item.model_code, unit_cost_excl_vat: item.unit_cost_excl_vat, qty: item.qty };
  });
  return countCashFlow({
    companyId,
    invoices: withJobs,
    payments: payments as CashPayment[],
    credits: credits as CashCredit[],
    linesByInvoice,
    quoteLinesByQuote,
    products: (products as any[]).map((p): CashProductCost => ({ id: p.id, cost_excl_vat: p.cost_excl_vat, cost_incl_vat: p.cost_incl_vat, vat_rate: p.vat_rate, product_code: p.product_code, product_category: p.product_category, category: p.category, supplier_type: supplierType(p), product_type: p.product_type })),
    commitments: commitments as CashCommitment[],
    allocations: allocations as { commitment_id: string; qty: number }[],
    poLines,
  });
}

export function useAdminHomeCashFlow() {
  const company = useQuery({ queryKey: ["caller-company-id"], staleTime: 300_000, queryFn: async () => ((await db.rpc("caller_company_id")).data as string | null) ?? null });
  const companyId = company.data ?? null;
  const q = useQuery({
    queryKey: ["admin-home-cash-flow", companyId],
    enabled: !!companyId && companyId !== TEST_HVAC_ID,
    refetchInterval: 60_000,
    queryFn: () => loadCashFlow(companyId!),
  });
  return { glance: q.data ?? null, loading: company.isLoading || (!!companyId && companyId !== TEST_HVAC_ID && q.isLoading), error: q.isError };
}

export default function AdminHomeCashFlowPie() {
  const { glance, loading, error } = useAdminHomeCashFlow();
  return <CashFlowPieCard glance={glance} loading={loading} error={error} />;
}
