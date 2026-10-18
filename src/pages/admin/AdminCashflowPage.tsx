import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Landmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatRand } from "@/utils/formatRand";
import { bankBalance, buildWeeks, isoDate, monthly, overdue } from "@/lib/cashflow";
import { useCashflowAccess, useCashflowData, useJobProfit } from "@/hooks/useCashflow";
import CashflowChart from "@/components/cashflow/CashflowChart";

const Stat = ({ label, value, tone, sub }: { label: string; value: string; tone?: "red" | "green"; sub?: string }) => (
  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">{label}</div>
    <div className={`text-lg font-bold ${tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : ""}`}>{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</CardContent></Card>
);

/** Owner + admin only: cash flow (bank, in/out, 12 weeks) and profit per job / month. */
export default function AdminCashflowPage() {
  const { companyId, allowed, loading } = useCashflowAccess();
  const [tab, setTab] = useState<"cash" | "profit">("cash");
  const [withExpected, setWithExpected] = useState(false);
  const now = new Date();
  const [from, setFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 1)));
  const [to, setTo] = useState(isoDate(now));
  const cf = useCashflowData(companyId, !!allowed);
  const jp = useJobProfit(companyId, from, to, !!allowed && tab === "profit");

  const weeks = useMemo(() => (cf.data ? buildWeeks(cf.data.data, new Date(), 12, cf.data.depositPct) : []), [cf.data]);
  if (loading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!allowed) return <div className="p-6 text-sm text-muted-foreground">Only owners and admins can see cash flow.</div>;

  const d = cf.data?.data;
  const bank = d ? bankBalance(d) : { total: 0, asOf: null };
  const owedToUs = d ? d.receivables.reduce((s, r) => s + Number(r.outstanding), 0) : 0;
  const weOwe = d ? d.payables.reduce((s, r) => s + Number(r.outstanding), 0) + d.open_pos.reduce((s, p) => s + Number(p.total), 0) : 0;
  const expected = d ? d.expected.reduce((s, q) => s + Number(q.total), 0) : 0;
  const low = weeks.reduce((m, w) => Math.min(m, withExpected ? w.closingWithExpected : w.closing), bank.total);
  const firstNeg = weeks.find((w) => (withExpected ? w.closingWithExpected : w.closing) < 0);
  const odIn = d ? overdue(d.receivables) : [];
  const odOut = d ? overdue(d.payables) : [];

  return (
    <div className="space-y-4 p-3 md:p-6" data-testid="cashflow-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold">Cash flow & profit</h1><p className="text-xs text-muted-foreground">Owner and admin only. Amounts incl. VAT on the cash side; profit is excl. VAT.</p></div>
        <div className="flex gap-1">{(["cash", "profit"] as const).map((t) => <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t === "cash" ? "Cash flow" : "Profit"}</Button>)}</div>
      </div>

      {tab === "cash" && (cf.isLoading || !d ? <Loader2 className="h-5 w-5 animate-spin" /> : <>
        {firstNeg && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200" data-testid="cashflow-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Cash goes below zero in the week of {firstNeg.label}</b> (lowest {formatRand(low)}). Chase overdue invoices or move supplier payments.</div>
          </div>)}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Bank balance (FNB)" value={formatRand(bank.total)} sub={bank.asOf ? `as of last import ${bank.asOf}` : "no statement imported yet"} />
          <Stat label="Clients owe us" value={formatRand(owedToUs)} tone="green" sub={`${odIn.length} overdue`} />
          <Stat label="We owe suppliers" value={formatRand(weOwe)} tone={weOwe > 0 ? "red" : undefined} sub={`${odOut.length} overdue · incl. open POs`} />
          <Stat label="Expected (accepted, not invoiced)" value={formatRand(expected)} sub={`${d.expected.length} quotes · not in balance unless ticked`} />
        </div>
        {!bank.asOf && <p className="text-xs text-muted-foreground"><Landmark className="mr-1 inline h-3.5 w-3.5" />Import an FNB statement under <Link className="underline" to="/admin/bank">Bank (FNB)</Link> so the projection starts from your real balance.</p>}
        <Card><CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">Next 12 weeks</div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={withExpected} onChange={(e) => setWithExpected(e.target.checked)} />Include expected deposits from accepted quotes</label></div>
          <CashflowChart weeks={weeks} withExpected={withExpected} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Week of</th><th className="text-right">In</th>{withExpected && <th className="text-right">Expected</th>}<th className="text-right">Out</th><th className="text-right">Net</th><th className="text-right">Balance</th></tr></thead>
              <tbody>{weeks.map((w, i) => { const bal = withExpected ? w.closingWithExpected : w.closing; return (
                <tr key={w.start} className="border-t" title={w.items.map((it) => `${it.kind === "out" ? "−" : "+"} ${formatRand(it.amount)} ${it.label}`).join("\n")}>
                  <td className="py-1">{w.label}{i === 0 && <span className="text-muted-foreground"> (incl. overdue)</span>}</td>
                  <td className="text-right text-emerald-700">{w.inflow ? formatRand(w.inflow) : "–"}</td>
                  {withExpected && <td className="text-right text-emerald-500">{w.expected ? formatRand(w.expected) : "–"}</td>}
                  <td className="text-right text-orange-700">{w.outflow ? formatRand(w.outflow) : "–"}</td>
                  <td className="text-right">{formatRand(w.net + (withExpected ? w.expected : 0))}</td>
                  <td className={`text-right font-semibold ${bal < 0 ? "text-red-600" : ""}`}>{formatRand(bal)}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </CardContent></Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Overdue: clients owe us</div>
            {odIn.length === 0 ? <p className="text-xs text-muted-foreground">Nothing overdue.</p> : <ul className="space-y-1 text-xs">{odIn.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link className="truncate underline" to={`/admin/invoices/${r.id}`}>{r.invoice_number} {r.customer_name}</Link><span className="shrink-0">{formatRand(Number(r.outstanding))} · due {r.due_date}</span></li>)}</ul>}
          </CardContent></Card>
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Overdue: we owe suppliers</div>
            {odOut.length === 0 ? <p className="text-xs text-muted-foreground">Nothing overdue.</p> : <ul className="space-y-1 text-xs">{odOut.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link className="truncate underline" to="/admin/supplier-bills">{r.supplier_name} {r.bill_number || ""}</Link><span className="shrink-0">{formatRand(Number(r.outstanding))} · due {r.due_date}</span></li>)}</ul>}
          </CardContent></Card>
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Expected income (accepted quotes, no invoice yet)</div>
            {d.expected.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : <ul className="space-y-1 text-xs">{d.expected.map((q) => <li key={q.id} className="flex justify-between gap-2"><span className="truncate">{q.quote_number} {q.customer_name}</span><span className="shrink-0">{formatRand(Number(q.total))}</span></li>)}</ul>}
          </CardContent></Card>
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Not counted yet</div>
            <p className="text-xs text-muted-foreground">{d.draft_invoices.length} draft invoice(s) ({formatRand(d.draft_invoices.reduce((s, r) => s + Number(r.grand_total || 0), 0))}) aren't sent, so they're left out until they are.</p>
          </CardContent></Card>
        </div>
      </>)}

      {tab === "profit" && <>
        <div className="flex flex-wrap items-end gap-2">
          <div><div className="text-xs text-muted-foreground">From</div><Input type="date" className="h-8" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><div className="text-xs text-muted-foreground">To</div><Input type="date" className="h-8" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {jp.isLoading || !jp.data ? <Loader2 className="h-5 w-5 animate-spin" /> : <>
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Profit per month</div>
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Month</th><th className="text-right">Income</th><th className="text-right">Units & materials</th><th className="text-right">Tech pay</th><th className="text-right">Overheads</th><th className="text-right">Profit</th></tr></thead>
              <tbody>{monthly(jp.data).map((m) => <tr key={m.month} className="border-t"><td className="py-1">{m.month}</td><td className="text-right">{formatRand(m.income)}</td><td className="text-right">{formatRand(m.materials)}</td><td className="text-right">{formatRand(m.tech_pay)}</td><td className="text-right">{formatRand(m.overheads)}</td><td className={`text-right font-semibold ${m.profit < 0 ? "text-red-600" : ""}`}>{formatRand(m.profit)}</td></tr>)}</tbody>
            </table></div>
            <p className="mt-1 text-xs text-muted-foreground">Income = sent/paid invoices excl. VAT. Overheads = expenses not linked to a job.</p>
          </CardContent></Card>
          <Card><CardContent className="p-3"><div className="mb-1 font-semibold">Profit per job <span className="text-xs font-normal text-muted-foreground">· GP target {jp.data.target}%</span></div>
            {jp.data.jobs.length === 0 ? <p className="text-xs text-muted-foreground">No jobs in this period.</p> : <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="job-profit">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Job</th><th className="text-right">Income</th><th className="text-right">Units & materials</th><th className="text-right">Tech pay</th><th className="text-right">Profit</th><th className="text-right">GP %</th></tr></thead>
              <tbody>{jp.data.jobs.map((j) => { const below = j.gp_pct !== null && j.gp_pct < jp.data!.target; return (
                <tr key={j.id} className="border-t"><td className="py-1"><div className="max-w-[260px] truncate font-medium">{j.title || "Job"}</div><div className="text-xs text-muted-foreground">{j.date} · {j.status}{j.income === 0 ? " · not invoiced yet" : ""}</div></td>
                  <td className="text-right">{formatRand(j.income)}</td><td className="text-right">{formatRand(j.materials)}</td><td className="text-right">{formatRand(j.tech_pay)}</td>
                  <td className={`text-right font-semibold ${j.profit < 0 ? "text-red-600" : ""}`}>{formatRand(j.profit)}</td>
                  <td className="text-right">{j.gp_pct === null ? "–" : <span className={`rounded px-1.5 py-0.5 ${below ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{j.gp_pct}%{below ? " ▼ below target" : ""}</span>}</td></tr>); })}</tbody>
            </table></div>}
          </CardContent></Card>
        </>}
      </>}
    </div>
  );
}
