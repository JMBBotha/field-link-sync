/** Cash-flow health (phase 1): 13-week forecast, health light, runway, VAT periods, per-project cover, alerts.
 *  Pure functions; amounts incl VAT. Rows come from cf_* tables (owner/management only, RLS _cf_ok). */
import { isoDate, mondayOf } from "@/lib/cashflow";

export type CfSettings = {
  company_id: string; enabled: boolean; buffer_mode: "overheads_month" | "fixed"; buffer_amount: number; unit_cost_factor: number;
  default_leeway_days: number; conf_sent: number; conf_overdue: number; conf_draft: number; conf_final_before_install: number;
  vat_number: string | null; vat_basis: "invoice" | "payment"; vat_period_months: number; vat_period_end: string | null; vat_due_day: number; vat_rate: number;
};
export type Receipt = {
  id: string; source: "field_lynk" | "manual" | "freshbooks"; invoice_id: string | null; quote_id: string | null; ref: string; client: string | null;
  part: "deposit" | "progress" | "final" | "full"; amount_incl: number; vat_incl: number; expected_date: string | null; leeway_days: number; confidence: number;
  status: "expected" | "received" | "written_off"; received_date: string | null; note: string | null;
};
export type CommitStatus = "needed" | "ordered_paid" | "in_stock" | "installed";
export type Commitment = {
  id: string; source_key: string | null; invoice_id: string | null; quote_id: string | null; job_id: string | null; project: string; item: string;
  kind: "unit" | "material" | "other"; qty: number; supplier: string | null; unit_cost_excl: number; vat_rate: number; status: CommitStatus; pay_date: string | null; note: string | null;
};
export type StockItem = { id: string; item: string; model_code: string | null; qty_on_hand: number; unit_cost_excl: number; location: string | null; last_counted_at: string | null; active: boolean };
export type Allocation = { id: string; stock_item_id: string; commitment_id: string; qty: number; drawn_at: string | null };
export type Overhead = { id: string; name: string; category: string; amount: number; frequency: "weekly" | "monthly" | "annual" | "once"; pay_day: number | null; pay_date: string | null; start_date: string | null; end_date: string | null; active: boolean; sort: number; note: string | null };
export type BankAccount = { id: string; label: string; account_ref: string | null; include: boolean; sort: number };
export type BankBalance = { id: string; account_id: string; balance: number; as_of: string; created_at: string };
export type InvoiceLite = { id: string; invoice_number: string | null; status: string; issue_date: string | null; tax_amount: number; grand_total: number };
export type VatActuals = { output_invoice: number; output_payment: number; input: number };

export type CashHealthData = {
  settings: CfSettings; receipts: Receipt[]; commitments: Commitment[]; stock: StockItem[]; allocations: Allocation[];
  overheads: Overhead[]; accounts: BankAccount[]; balances: BankBalance[]; invoices: InvoiceLite[];
  vat: { current: VatActuals; previous: VatActuals };
};

export const COMMIT_STATUS: Record<CommitStatus, string> = { needed: "Needed", ordered_paid: "Ordered / paid", in_stock: "In stock", installed: "Installed" };
export const PART_LABEL: Record<Receipt["part"], string> = { deposit: "Deposit", progress: "Progress", final: "Final", full: "Full" };

const DAY = 86400000;
export const parseDate = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Whole rands, SA spacing: R 61 218 / −R 61 218. */
export function rand0(v: number) {
  const n = Math.round(Math.abs(v));
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${v < -0.5 ? "−" : ""}R ${s}`;
}
export const randK = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? "−" : ""}R${Math.round(Math.abs(v) / 1000)}k` : rand0(v));

// ---------- bank ----------
export function latestBalances(accounts: BankAccount[], balances: BankBalance[]) {
  return accounts.map((a) => {
    const b = balances.filter((x) => x.account_id === a.id).sort((x, y) => (y.as_of + y.created_at).localeCompare(x.as_of + x.created_at))[0];
    return { account: a, balance: b ? num(b.balance) : null, as_of: b?.as_of ?? null };
  });
}
export function startBalance(accounts: BankAccount[], balances: BankBalance[]) {
  const rows = latestBalances(accounts, balances).filter((r) => r.account.include);
  const entered = rows.filter((r) => r.balance !== null);
  const asOf = entered.reduce<string | null>((m, r) => (!m || (r.as_of && r.as_of < m) ? r.as_of : m), null);
  return { total: entered.reduce((s, r) => s + (r.balance ?? 0), 0), entered: entered.length > 0, missing: rows.length - entered.length, asOf };
}

// ---------- overheads ----------
export function monthlyOverheads(rows: Overhead[]) {
  return r2(rows.filter((o) => o.active).reduce((s, o) => s + (o.frequency === "weekly" ? num(o.amount) * 52 / 12 : o.frequency === "monthly" ? num(o.amount) : o.frequency === "annual" ? num(o.amount) / 12 : 0), 0));
}
const inRange = (o: Overhead, d: Date) => (!o.start_date || d >= parseDate(o.start_date)) && (!o.end_date || d <= parseDate(o.end_date));
/** Every overhead payment between from..to (inclusive). Weekly on pay_day (1=Mon..7=Sun), monthly on day of month (clamped). */
export function overheadEvents(rows: Overhead[], from: Date, to: Date) {
  const out: { date: string; amount: number; name: string }[] = [];
  for (const o of rows) {
    if (!o.active || num(o.amount) <= 0) continue;
    if (o.frequency === "weekly") {
      const wd = Math.min(Math.max(o.pay_day ?? 5, 1), 7);
      for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) { const d = addDays(m, wd - 1); if (d >= from && d <= to && inRange(o, d)) out.push({ date: isoDate(d), amount: num(o.amount), name: o.name }); }
    } else if (o.frequency === "monthly") {
      for (let y = from.getFullYear(), mo = from.getMonth(); new Date(y, mo, 1) <= to; mo === 11 ? (y++, mo = 0) : mo++) {
        const last = new Date(y, mo + 1, 0).getDate();
        const d = new Date(y, mo, Math.min(o.pay_day ?? 1, last));
        if (d >= from && d <= to && inRange(o, d)) out.push({ date: isoDate(d), amount: num(o.amount), name: o.name });
      }
    } else if (o.pay_date) {
      let d = parseDate(o.pay_date);
      if (o.frequency === "annual") while (d < from) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
      if (d >= from && d <= to) out.push({ date: isoDate(d), amount: num(o.amount), name: o.name });
    }
  }
  return out;
}

// ---------- commitments / stock ----------
export const allocatedQty = (c: Commitment, allocs: Allocation[]) => allocs.filter((a) => a.commitment_id === c.id).reduce((s, a) => s + num(a.qty), 0);
export const unitCostIncl = (c: Commitment) => num(c.unit_cost_excl) * (1 + num(c.vat_rate) / 100);
/** Cash still to pay for a line: only while 'needed', less whatever stock already covers it. */
export const stillToPay = (c: Commitment, allocs: Allocation[]) => (c.status === "needed" ? r2(Math.max(0, num(c.qty) - allocatedQty(c, allocs)) * unitCostIncl(c)) : 0);
export function freeStock(s: StockItem, allocs: Allocation[]) {
  return num(s.qty_on_hand) - allocs.filter((a) => a.stock_item_id === s.id && !a.drawn_at).reduce((t, a) => t + num(a.qty), 0);
}
export const stockValue = (rows: StockItem[]) => r2(rows.filter((s) => s.active).reduce((t, s) => t + num(s.qty_on_hand) * num(s.unit_cost_excl), 0));

// ---------- VAT periods ----------
export type VatPeriod = { start: string; end: string; due: string };
/** Period containing `day`, stepping from the anchor period end by vat_period_months. */
export function vatPeriodFor(s: Pick<CfSettings, "vat_period_months" | "vat_period_end" | "vat_due_day">, day: Date): VatPeriod {
  const n = s.vat_period_months || 2;
  const anchor = s.vat_period_end ? parseDate(s.vat_period_end) : new Date(day.getFullYear(), day.getMonth() + 1, 0);
  // month index of period ends: anchorMonth + k*n
  const am = anchor.getFullYear() * 12 + anchor.getMonth();
  const dm = day.getFullYear() * 12 + day.getMonth();
  const k = Math.ceil((dm - am) / n);
  const endM = am + k * n;
  const end = new Date(Math.floor(endM / 12), endM % 12 + 1, 0);
  const start = new Date(Math.floor((endM - n + 1) / 12), (endM - n + 1) % 12, 1);
  const due = new Date(end.getFullYear(), end.getMonth() + 1, Math.min(s.vat_due_day || 25, 28));
  return { start: isoDate(start), end: isoDate(end), due: isoDate(due) };
}
export const nextPeriod = (s: Pick<CfSettings, "vat_period_months" | "vat_period_end" | "vat_due_day">, p: VatPeriod) => vatPeriodFor(s, addDays(parseDate(p.end), 1));
export const prevPeriod = (s: Pick<CfSettings, "vat_period_months" | "vat_period_end" | "vat_due_day">, p: VatPeriod) => vatPeriodFor(s, addDays(parseDate(p.start), -1));

const vatOf = (amountIncl: number, rate: number) => (amountIncl * rate) / (100 + rate);
const receiptVat = (r: Receipt, rate: number) => (num(r.vat_incl) > 0 ? num(r.vat_incl) : r.source === "manual" || r.source === "freshbooks" ? vatOf(num(r.amount_incl), rate) : 0);

/** Future VAT events (dated today or later). Invoice basis: a draft invoice's whole VAT lands when it is expected to go out
 *  (its earliest open part); quote-based and manual rows count per part. Payment basis: VAT on each expected receipt. */
export function vatEvents(d: Pick<CashHealthData, "settings" | "receipts" | "commitments" | "allocations" | "invoices">, today: Date) {
  const rate = num(d.settings.vat_rate) || 15;
  const t = isoDate(today);
  const at = (date: string | null) => (!date || date < t ? t : date);
  const output: { date: string; amount: number; label: string }[] = [];
  const open = d.receipts.filter((r) => r.status === "expected");
  if (d.settings.vat_basis === "payment") {
    for (const r of open) output.push({ date: at(r.expected_date), amount: receiptVat(r, rate), label: `${r.ref} ${PART_LABEL[r.part]}` });
  } else {
    const inv = new Map(d.invoices.map((i) => [i.id, i]));
    const firstByInvoice = new Map<string, string>();
    for (const r of open) {
      if (r.invoice_id) {
        const i = inv.get(r.invoice_id);
        if (!i || i.status !== "draft") continue; // already invoiced: counted in its own period's actuals
        const cur = firstByInvoice.get(i.id);
        const dd = at(r.expected_date);
        if (!cur || dd < cur) firstByInvoice.set(i.id, dd);
      } else output.push({ date: at(r.expected_date), amount: receiptVat(r, rate), label: `${r.ref} ${PART_LABEL[r.part]}` });
    }
    for (const [id, date] of firstByInvoice) { const i = inv.get(id)!; output.push({ date, amount: num(i.tax_amount), label: `${i.invoice_number ?? ""} invoice` }); }
  }
  const input = d.commitments.map((c) => ({ c, pay: stillToPay(c, d.allocations) })).filter((x) => x.pay > 0)
    .map(({ c, pay }) => ({ date: at(c.pay_date), amount: vatOf(pay, num(c.vat_rate) || rate), label: c.item }));
  return { output, input };
}

export type VatSummary = { period: VatPeriod; collectedSoFar: number; inputSoFar: number; netSoFar: number; expectedOutput: number; expectedInput: number; expectedOwed: number; previous: { period: VatPeriod; owed: number } | null; payments: { date: string; amount: number; label: string }[] };
export function vatSummary(d: CashHealthData, today: Date, windowEnd: Date): VatSummary {
  const s = d.settings;
  const period = vatPeriodFor(s, today);
  const basisOut = (a: VatActuals) => (s.vat_basis === "payment" ? num(a.output_payment) : num(a.output_invoice));
  const ev = vatEvents(d, today);
  const sumIn = (rows: { date: string; amount: number }[], p: VatPeriod) => rows.filter((e) => e.date >= p.start && e.date <= p.end).reduce((t, e) => t + e.amount, 0);
  const collectedSoFar = r2(basisOut(d.vat.current));
  const inputSoFar = r2(num(d.vat.current.input));
  const expectedOutput = r2(collectedSoFar + sumIn(ev.output, period));
  const expectedInput = r2(inputSoFar + sumIn(ev.input, period));
  const prev = prevPeriod(s, period);
  const prevOwed = r2(basisOut(d.vat.previous) - num(d.vat.previous.input));
  const payments: VatSummary["payments"] = [];
  const t = isoDate(today);
  if (prev.due >= t && Math.abs(prevOwed) > 0.5) payments.push({ date: prev.due, amount: prevOwed, label: `VAT ${prev.start.slice(5)}–${prev.end.slice(5)} to SARS` });
  payments.push({ date: period.due, amount: r2(expectedOutput - expectedInput), label: `VAT ${period.start.slice(5)}–${period.end.slice(5)} to SARS` });
  for (let p = nextPeriod(s, period); parseDate(p.due) <= windowEnd; p = nextPeriod(s, p)) {
    payments.push({ date: p.due, amount: r2(sumIn(ev.output, p) - sumIn(ev.input, p)), label: `VAT ${p.start.slice(5)}–${p.end.slice(5)} to SARS` });
  }
  return { period, collectedSoFar, inputSoFar, netSoFar: r2(collectedSoFar - inputSoFar), expectedOutput, expectedInput, expectedOwed: r2(expectedOutput - expectedInput),
    previous: prev.due >= t ? { period: prev, owed: prevOwed } : null, payments: payments.filter((p) => parseDate(p.date) <= windowEnd) };
}

// ---------- forecast ----------
export type FWeek = { start: string; label: string; inExpected: number; inCautious: number; units: number; overheads: number; vat: number; balance: number; balanceCautious: number; lines: { kind: "in" | "units" | "overheads" | "vat"; label: string; amount: number }[] };
export type Health = "green" | "amber" | "red";
export type Forecast = {
  weeks: FWeek[]; start: number; bankEntered: boolean; bankAsOf: string | null; buffer: number; monthlyOverheads: number;
  lowest: { value: number; index: number }; lowestCautious: { value: number; index: number }; runwayWeeks: number | null; health: Health;
  totals: { inExpected: number; units: number; overheads: number; vat: number }; closing: number; vatSummary: VatSummary;
};

export function forecast(d: CashHealthData, today = new Date(), nWeeks = 13): Forecast {
  const w0 = mondayOf(today);
  const end = addDays(w0, nWeeks * 7 - 1);
  const weeks: FWeek[] = Array.from({ length: nWeeks }, (_, i) => {
    const s = addDays(w0, i * 7);
    return { start: isoDate(s), label: s.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }), inExpected: 0, inCautious: 0, units: 0, overheads: 0, vat: 0, balance: 0, balanceCautious: 0, lines: [] };
  });
  const idx = (date: string | null) => { if (!date) return 0; const n = Math.floor((parseDate(date).getTime() - w0.getTime()) / (7 * DAY)); return n < 0 ? 0 : n >= nWeeks ? -1 : n; };

  for (const r of d.receipts) {
    if (r.status !== "expected") continue;
    const i = idx(r.expected_date);
    if (i >= 0) { weeks[i].inExpected += num(r.amount_incl); weeks[i].lines.push({ kind: "in", label: `${r.ref} ${r.client ?? ""} · ${PART_LABEL[r.part]}`.trim(), amount: num(r.amount_incl) }); }
    const late = r.expected_date ? isoDate(addDays(parseDate(r.expected_date), num(r.leeway_days))) : null;
    const j = idx(late);
    if (j >= 0) weeks[j].inCautious += num(r.amount_incl) * Math.min(Math.max(num(r.confidence), 0), 100) / 100;
  }
  for (const c of d.commitments) {
    const pay = stillToPay(c, d.allocations); if (pay <= 0) continue;
    const i = idx(c.pay_date); if (i < 0) continue;
    weeks[i].units += pay; weeks[i].lines.push({ kind: "units", label: `${c.item} · ${c.project}`.trim(), amount: pay });
  }
  for (const o of overheadEvents(d.overheads, today < w0 ? w0 : new Date(today.getFullYear(), today.getMonth(), today.getDate()), end)) {
    const i = idx(o.date); if (i < 0) continue; weeks[i].overheads += o.amount; weeks[i].lines.push({ kind: "overheads", label: o.name, amount: o.amount });
  }
  const vs = vatSummary(d, today, end);
  for (const p of vs.payments) { const i = idx(p.date); if (i < 0) continue; weeks[i].vat += p.amount; weeks[i].lines.push({ kind: "vat", label: p.label, amount: p.amount }); }

  const sb = startBalance(d.accounts, d.balances);
  let bal = sb.total, balC = sb.total;
  for (const w of weeks) {
    const out = w.units + w.overheads + w.vat;
    bal += w.inExpected - out; balC += w.inCautious - out;
    w.balance = r2(bal); w.balanceCautious = r2(balC);
  }
  const mo = monthlyOverheads(d.overheads);
  const buffer = d.settings.buffer_mode === "fixed" ? num(d.settings.buffer_amount) : mo;
  const minOf = (k: "balance" | "balanceCautious") => weeks.reduce((m, w, i) => (w[k] < m.value ? { value: w[k], index: i } : m), { value: weeks[0]?.[k] ?? 0, index: 0 });
  const lowest = minOf("balance"), lowestCautious = minOf("balanceCautious");
  const firstNeg = weeks.findIndex((w) => w.balance < 0);
  const weeklyOv = mo * 12 / 52;
  const closing = weeks[weeks.length - 1]?.balance ?? sb.total;
  const runwayWeeks = firstNeg >= 0 ? firstNeg : weeklyOv > 0 ? Math.floor(nWeeks + Math.max(0, closing) / weeklyOv) : null;
  const health: Health = lowest.value < 0 ? "red" : lowest.value < buffer || lowestCautious.value < 0 ? "amber" : "green";
  const sum = (k: "inExpected" | "units" | "overheads" | "vat") => r2(weeks.reduce((t, w) => t + w[k], 0));
  return { weeks, start: sb.total, bankEntered: sb.entered, bankAsOf: sb.asOf, buffer, monthlyOverheads: mo, lowest, lowestCautious, runwayWeeks, health,
    totals: { inExpected: sum("inExpected"), units: sum("units"), overheads: sum("overheads"), vat: sum("vat") }, closing, vatSummary: vs };
}

// ---------- projects ----------
export type ProjectRow = {
  key: string; ref: string; client: string; label: string; invoiceValue: number;
  deposit: { amount: number; received: boolean; date: string | null } | null; final: { amount: number; received: boolean; date: string | null } | null;
  lines: Commitment[]; costTotal: number; stillToBuy: number; stockCovered: number; cover: number; status: CommitStatus | "mixed" | "none";
};
export function projects(d: Pick<CashHealthData, "receipts" | "commitments" | "allocations">): ProjectRow[] {
  const map = new Map<string, ProjectRow>();
  const keyOf = (inv: string | null, q: string | null, fallback: string) => (inv ? `i:${inv}` : q ? `q:${q}` : `p:${fallback}`);
  const get = (k: string, ref: string, client: string) => {
    if (!map.has(k)) map.set(k, { key: k, ref, client, label: "", invoiceValue: 0, deposit: null, final: null, lines: [], costTotal: 0, stillToBuy: 0, stockCovered: 0, cover: 0, status: "none" });
    return map.get(k)!;
  };
  for (const r of d.receipts) {
    if (r.status === "written_off") continue;
    const p = get(keyOf(r.invoice_id, r.quote_id, r.ref), r.ref, r.client ?? "");
    p.invoiceValue += num(r.amount_incl);
    const part = { amount: num(r.amount_incl), received: r.status === "received", date: r.status === "received" ? r.received_date : r.expected_date };
    if (r.part === "deposit" || r.part === "full") p.deposit = part; else if (r.part === "final") p.final = part;
  }
  for (const c of d.commitments) {
    const [ref, ...rest] = c.project.split(" ");
    const p = get(keyOf(c.invoice_id, c.quote_id, c.project), ref || c.project, rest.join(" "));
    p.lines.push(c);
    if (!p.label && rest.length) p.label = rest.join(" ");
    p.costTotal += num(c.qty) * unitCostIncl(c);
    p.stillToBuy += stillToPay(c, d.allocations);
    p.stockCovered += Math.min(allocatedQty(c, d.allocations), num(c.qty)) * unitCostIncl(c);
  }
  const rows = [...map.values()].filter((p) => p.lines.length > 0 || (p.deposit && !p.deposit.received) || (p.final && !p.final.received));
  for (const p of rows) {
    p.cover = r2((p.deposit?.amount ?? 0) - p.stillToBuy);
    const st = new Set(p.lines.map((l) => l.status));
    p.status = st.size === 0 ? "none" : st.size === 1 ? [...st][0] : "mixed";
    p.costTotal = r2(p.costTotal); p.stillToBuy = r2(p.stillToBuy); p.stockCovered = r2(p.stockCovered); p.invoiceValue = r2(p.invoiceValue);
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
}

// ---------- alerts ----------
export type Alert = { tone: "red" | "amber" | "info"; text: string; tab?: "in" | "projects" | "stock" | "settings" };
export function alerts(d: CashHealthData, f: Forecast, today = new Date()): Alert[] {
  const out: Alert[] = [];
  const t = isoDate(today);
  const wk = (i: number) => `week ${i + 1} (${f.weeks[i]?.label ?? ""})`;
  if (!f.bankEntered) out.push({ tone: "amber", text: "Enter today's bank balance so the forecast starts from real money.", tab: "settings" });
  else if (f.bankAsOf && (today.getTime() - parseDate(f.bankAsOf).getTime()) / DAY > 7) out.push({ tone: "amber", text: `Bank balance is from ${f.bankAsOf}. Update it (Mondays).`, tab: "settings" });
  if (f.lowest.value < 0) out.push({ tone: "red", text: `Cash goes below R0 in ${wk(f.lowest.index)}: ${rand0(f.lowest.value)}. Chase finals, stagger orders, or arrange finance.` });
  else if (f.lowest.value < f.buffer) out.push({ tone: "amber", text: `Cash dips under your buffer (${rand0(f.buffer)}) in ${wk(f.lowest.index)}: ${rand0(f.lowest.value)}.` });
  if (f.lowest.value >= 0 && f.lowestCautious.value < 0) out.push({ tone: "amber", text: `If clients pay late, cash goes below R0 in ${wk(f.lowestCautious.index)} (${rand0(f.lowestCautious.value)}).` });
  const ps = projects(d);
  for (const p of ps) {
    const needed = p.lines.filter((l) => l.status === "needed" && stillToPay(l, d.allocations) > 0);
    if (p.deposit?.received && needed.length) out.push({ tone: "amber", text: `${p.ref} ${p.client}: deposit received but ${needed.length} unit${needed.length > 1 ? "s" : ""} not ordered yet.`, tab: "projects" });
  }
  const short = ps.filter((p) => p.cover < -0.5 && p.stillToBuy > 0);
  if (short.length) {
    const gap = short.reduce((s, p) => s + p.cover, 0);
    out.push({ tone: "amber", text: `${short.length} job${short.length > 1 ? "s" : ""}: the deposit doesn't cover the units still to buy (short ${rand0(-gap)} in total).`, tab: "projects" });
  }
  const inv = new Map(d.invoices.map((i) => [i.id, i]));
  const weekEnd = isoDate(addDays(mondayOf(today), 6));
  const draftSoon = new Set(d.receipts.filter((r) => r.status === "expected" && r.invoice_id && inv.get(r.invoice_id)?.status === "draft" && r.expected_date && r.expected_date <= weekEnd).map((r) => r.ref));
  if (draftSoon.size) out.push({ tone: "amber", text: `Still drafts but money is expected this week: ${[...draftSoon].slice(0, 6).join(", ")}${draftSoon.size > 6 ? "…" : ""}. Send them.`, tab: "in" });
  const late = d.receipts.filter((r) => r.status === "expected" && r.expected_date && isoDate(addDays(parseDate(r.expected_date), num(r.leeway_days))) < t);
  if (late.length) out.push({ tone: "red", text: `${late.length} payment${late.length > 1 ? "s" : ""} overdue past the leeway: ${late.slice(0, 4).map((r) => `${r.ref} ${PART_LABEL[r.part].toLowerCase()}`).join(", ")}.`, tab: "in" });
  const vatSoon = f.vatSummary.payments.find((p) => p.amount > 0.5 && (parseDate(p.date).getTime() - today.getTime()) / DAY <= 14);
  if (vatSoon) out.push({ tone: "info", text: `${vatSoon.label}: about ${rand0(vatSoon.amount)} due ${vatSoon.date}.` });
  const billWeek = d.commitments.filter((c) => stillToPay(c, d.allocations) > 0 && c.pay_date && c.pay_date <= weekEnd);
  if (billWeek.length) out.push({ tone: "info", text: `Units to pay for this week: ${rand0(billWeek.reduce((s, c) => s + stillToPay(c, d.allocations), 0))} (${billWeek.length} line${billWeek.length > 1 ? "s" : ""}).`, tab: "projects" });
  return out;
}
