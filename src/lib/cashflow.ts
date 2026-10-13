/** Cash-flow helpers: weekly buckets (Mon-Sun, SAST dates) for money in / out. Pure functions. */
export type CfData = {
  bank: { account_label: string; txn_date: string; balance: number }[];
  receivables: { id: string; invoice_number: string; customer_name: string | null; due_date: string | null; issue_date: string | null; status: string; outstanding: number }[];
  draft_invoices: { id: string; invoice_number: string; customer_name: string | null; grand_total: number; due_date: string | null }[];
  expected: { id: string; quote_number: string; customer_name: string | null; total: number; accepted_at: string | null }[];
  payables: { id: string; bill_number: string | null; supplier_name: string | null; due_date: string | null; status: string; outstanding: number; po_id: string | null }[];
  open_pos: { id: string; po_number: string; supplier_name: string | null; total: number; status: string; created_at: string; terms: number }[];
  as_of: string;
};

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** Never trust the RPC shape: null / missing / non-array parts become empty lists (dashboard must not crash). */
export function normalizeCf(raw: unknown): CfData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CfData>;
  return { bank: arr(r.bank), receivables: arr(r.receivables), draft_invoices: arr(r.draft_invoices), expected: arr(r.expected), payables: arr(r.payables), open_pos: arr(r.open_pos), as_of: typeof r.as_of === "string" ? r.as_of : "" };
}
export const isEmptyCf = (d: CfData) => !d.bank.length && !d.receivables.length && !d.payables.length && !d.open_pos.length && !d.expected.length;

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export type Week = { start: string; label: string; inflow: number; outflow: number; expected: number; net: number; closing: number; closingWithExpected: number; items: { kind: "in" | "out" | "expected"; label: string; amount: number; date: string }[] };

export function bankBalance(d: CfData) {
  const total = d.bank.reduce((s, b) => s + Number(b.balance || 0), 0);
  const asOf = d.bank.reduce((m, b) => (b.txn_date > m ? b.txn_date : m), "");
  return { total, asOf: asOf || null };
}

/** 12 weeks starting this week. Anything overdue (or undated) lands in week 1. */
export function buildWeeks(d: CfData, today = new Date(), weeks = 12, depositPct = 70): Week[] {
  const w0 = mondayOf(today);
  const out: Week[] = Array.from({ length: weeks }, (_, i) => {
    const s = addDays(w0, i * 7);
    return { start: isoDate(s), label: s.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }), inflow: 0, outflow: 0, expected: 0, net: 0, closing: 0, closingWithExpected: 0, items: [] };
  });
  const idx = (date: string | null) => {
    if (!date) return 0;
    const n = Math.floor((parse(date).getTime() - w0.getTime()) / (7 * 86400000));
    return n < 0 ? 0 : n >= weeks ? -1 : n;
  };
  for (const r of d.receivables) { const i = idx(r.due_date); if (i >= 0) { out[i].inflow += Number(r.outstanding); out[i].items.push({ kind: "in", label: `${r.invoice_number} ${r.customer_name || ""}`.trim(), amount: Number(r.outstanding), date: r.due_date || "" }); } }
  for (const b of d.payables) { const i = idx(b.due_date); if (i >= 0) { out[i].outflow += Number(b.outstanding); out[i].items.push({ kind: "out", label: `${b.supplier_name || "Supplier"} ${b.bill_number || "(bill)"}`, amount: Number(b.outstanding), date: b.due_date || "" }); } }
  for (const p of d.open_pos) {
    const due = isoDate(addDays(parse(p.created_at), p.terms || 30));
    const i = idx(due); if (i >= 0) { out[i].outflow += Number(p.total); out[i].items.push({ kind: "out", label: `${p.po_number} ${p.supplier_name || ""} (PO, no bill yet)`.trim(), amount: Number(p.total), date: due }); }
  }
  for (const q of d.expected) {
    // Expected deposit 7 days after acceptance (shown separately, not in the main projection)
    const due = q.accepted_at ? isoDate(addDays(parse(q.accepted_at), 7)) : null;
    const amt = Math.round(Number(q.total) * depositPct) / 100;
    const i = idx(due); if (i >= 0) { out[i].expected += amt; out[i].items.push({ kind: "expected", label: `${q.quote_number} ${q.customer_name || ""} (deposit ${depositPct}%)`.trim(), amount: amt, date: due || "" }); }
  }
  let bal = bankBalance(d).total, balX = bal;
  for (const w of out) { w.net = w.inflow - w.outflow; bal += w.net; balX += w.net + w.expected; w.closing = bal; w.closingWithExpected = balX; }
  return out;
}

export const overdue = <T extends { due_date: string | null }>(rows: T[], today = new Date()) => rows.filter((r) => r.due_date && r.due_date < isoDate(today));

export type JobProfit = { id: string; title: string | null; customer_name: string | null; status: string; date: string; income: number; materials: number; tech_pay: number; profit: number; gp_pct: number | null };
export type ProfitData = { target: number; jobs: JobProfit[]; overheads: { month: string; amount: number }[]; unbilled_income: { month: string; amount: number }[] };

export function monthly(p: ProfitData) {
  const m = new Map<string, { month: string; income: number; materials: number; tech_pay: number; overheads: number; profit: number }>();
  const get = (k: string) => { if (!m.has(k)) m.set(k, { month: k, income: 0, materials: 0, tech_pay: 0, overheads: 0, profit: 0 }); return m.get(k)!; };
  for (const j of p.jobs) { const r = get(j.date.slice(0, 7)); r.income += j.income; r.materials += j.materials; r.tech_pay += j.tech_pay; }
  for (const u of p.unbilled_income) get(u.month).income += Number(u.amount);
  for (const o of p.overheads) get(o.month).overheads += Number(o.amount);
  const rows = [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
  for (const r of rows) r.profit = r.income - r.materials - r.tech_pay - r.overheads;
  return rows;
}
