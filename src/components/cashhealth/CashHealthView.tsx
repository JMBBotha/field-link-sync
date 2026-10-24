import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Plus, RefreshCw, Trash2 } from "lucide-react";
import { isoDate } from "@/lib/cashflow";
import {
  COMMIT_STATUS, PART_LABEL, inflowSeries, summary as buildSummary, alerts as buildAlerts, forecast as buildForecast, freeStock, latestBalances, projects as buildProjects, rand0, stillToPay, stockValue, unitCostIncl,
  type Alert, type CashHealthData, type CommitStatus, type Commitment, type Forecast, type Overhead, type ProjectRow, type Receipt,
} from "@/lib/cashHealth";
import type { CashHealthActions } from "@/hooks/useCashHealth";
import { cn } from "@/lib/utils";
import { BalanceChart, FlowBars, InflowChart } from "./CashHealthChart";
import { Btn, Card, Chip, Field, Pick, Stat } from "./cashHealthUi";

export type CashTab = "overview" | "in" | "projects" | "stock" | "settings";
const TABS: { key: CashTab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "in", label: "Money in" }, { key: "projects", label: "Projects" }, { key: "stock", label: "Stock" }, { key: "settings", label: "Settings" },
];
const n = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/[\s,R]/g, "")));
const fmtD = (s: string | null) => (s ? new Date(s.slice(0, 10) + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "–");
type Safe = (p: Promise<void>, ok?: string) => void;

/** Cash-flow health: one screen, five tabs. Presentational; all writes go through `actions` (RLS: owner/management only). */
export default function CashHealthView({ data, actions, companyName, tab: tabProp, onTab, today: todayProp, notify }: {
  data: CashHealthData; actions: CashHealthActions; companyName?: string; tab?: CashTab; onTab?: (t: CashTab) => void; today?: Date; notify?: (msg: string, error?: boolean) => void;
}) {
  // Live forecast start (cf_settings.forecast_start, Massair = 1 Nov 2026): until then the forecast runs from that date.
  const startIso = data.settings.forecast_start ?? null;
  const today = useMemo(() => {
    const now = todayProp ?? new Date();
    if (startIso && isoDate(now) < startIso) { const [y, m, d] = startIso.split("-").map(Number); return new Date(y, m - 1, d); }
    return now;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, todayProp ? todayProp.getTime() : isoDate(new Date())]);
  const preLive = !!startIso && isoDate(todayProp ?? new Date()) < startIso;
  const [tabState, setTabState] = useState<CashTab>("overview");
  const tab = tabProp ?? tabState;
  const setTab = (t: CashTab) => { setTabState(t); onTab?.(t); };
  const f = useMemo(() => buildForecast(data, today), [data, today]);
  const al = useMemo(() => buildAlerts(data, f, today), [data, f, today]);
  const safe: Safe = (p, ok) => { p.then(() => ok && notify?.(ok)).catch((e) => notify?.(e?.message || "Couldn't save", true)); };

  return (
    <div className="v8-scope mx-auto max-w-6xl space-y-3 p-3 md:p-6" data-testid="cash-health-page">
      <div className="v8-navy flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="v8-eyebrow">Owner & management only</div>
          <h1 className="text-2xl font-semibold text-ink">Cash-flow health</h1>
          <p className="text-xs text-ink-muted">{companyName ? `${companyName} · ` : ""}Week of {f.weeks[0]?.label} · next 13 weeks · amounts incl VAT</p>
        </div>
        <Btn variant="outline" onClick={() => safe(actions.resync(), "Updated from invoices and jobs")}><RefreshCw className="h-4 w-4" />Refresh</Btn>
      </div>
      {preLive && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="cash-prelive">
          Live forecast starts {new Date(today).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}. Figures are set up from that date; the opening bank balance is editable below.
        </div>
      )}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} data-testid={`cash-tab-${t.key}`}
            className={cn("h-9 flex-1 shrink-0 whitespace-nowrap rounded-lg px-1.5 text-sm font-semibold md:flex-none md:px-3", tab === t.key ? "bg-[#1590d6] text-white" : "text-ink-secondary hover:bg-muted")}>{t.label}</button>
        ))}
      </nav>
      {tab === "overview" && <Overview data={data} f={f} alerts={al} actions={actions} safe={safe} setTab={setTab} today={today} />}
      {tab === "in" && <MoneyIn data={data} f={f} actions={actions} safe={safe} today={today} />}
      {tab === "projects" && <Projects data={data} actions={actions} safe={safe} />}
      {tab === "stock" && <Stock data={data} actions={actions} safe={safe} />}
      {tab === "settings" && <Settings data={data} f={f} actions={actions} safe={safe} today={today} />}
    </div>
  );
}

// ---------------- Overview ----------------
const HEALTH = { red: { label: "RED", dot: "bg-red-600", text: "text-red-600 dark:text-red-300" }, amber: { label: "AMBER", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-300" }, green: { label: "GREEN", dot: "bg-emerald-600", text: "text-emerald-600 dark:text-emerald-300" } } as const;

function BankEntry({ data, actions, safe, today }: { data: CashHealthData; actions: CashHealthActions; safe: Safe; today: Date }) {
  const rows = latestBalances(data.accounts, data.balances);
  const first = rows[0];
  const [v, setV] = useState("");
  if (!first) return null;
  return (
    <div className="mt-1 flex gap-1.5">
      <Field ariaLabel="Bank balance today" value={v} onSave={setV} type="number" prefix="R" placeholder={first.balance === null ? "Type today's balance" : "New balance"} className="flex-1" />
      <Btn testId="cash-bank-save" disabled={v.trim() === ""} onClick={() => { safe(actions.saveBalance(first.account.id, n(v), isoDate(today)), "Bank balance saved"); setV(""); }}>Save</Btn>
    </div>
  );
}

function Overview({ data, f, alerts, actions, safe, setTab, today }: { data: CashHealthData; f: Forecast; alerts: Alert[]; actions: CashHealthActions; safe: Safe; setTab: (t: CashTab) => void; today: Date }) {
  const h = HEALTH[f.health];
  const low = f.weeks[f.lowest.index];
  const vs = f.vatSummary;
  const acc = latestBalances(data.accounts, data.balances);
  const reason = f.health === "red" ? `Cash goes below R0 in W${f.lowest.index + 1} (${low?.label}).` : f.health === "amber" ? (f.lowest.value < f.buffer ? `Dips under the buffer in W${f.lowest.index + 1}.` : "Late payments would take cash below R0.") : "Stays above the buffer all 13 weeks.";
  return (
    <div className="space-y-3">
      <Summary data={data} f={f} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Health" testId="cash-health-light" className="col-span-2 lg:col-span-1">
          <div className="mt-1 flex items-center gap-2"><span className={cn("h-5 w-5 rounded-full", h.dot)} /><span className={cn("text-xl font-semibold", h.text)}>{h.label}</span></div>
          <div className="mt-1 text-xs text-ink-muted">{reason}</div>
          <div className="text-xs text-ink-muted">Buffer {rand0(f.buffer)} = 1 month of overheads</div>
        </Stat>
        <Stat label="Bank balance today" value={f.bankEntered ? rand0(f.start) : "Not entered"} tone={f.bankEntered ? undefined : "amber"}
          sub={acc.map((a) => `${a.account.label} ${a.account.account_ref ?? ""}${a.as_of ? ` · ${fmtD(a.as_of)}` : ""}`).join(" + ")} testId="cash-bank" className="col-span-2 lg:col-span-1">
          <BankEntry data={data} actions={actions} safe={safe} today={today} />
        </Stat>
        <Stat label="Lowest point (13 wks)" value={rand0(f.lowest.value)} tone={f.lowest.value < 0 ? "red" : f.lowest.value < f.buffer ? "amber" : "green"}
          sub={`W${f.lowest.index + 1} · ${low?.label ?? ""}${f.lowestCautious.value < f.lowest.value ? ` · cautious ${rand0(f.lowestCautious.value)}` : ""}`} />
        <Stat label="Cash after 13 weeks" value={rand0(f.closing)} tone={f.closing < 0 ? "red" : undefined}
          sub={f.runwayWeeks === null ? "No overheads entered" : f.runwayWeeks === 0 ? "Runway: cash runs out this week" : f.runwayWeeks < 13 ? `Runway: ${f.runwayWeeks} week${f.runwayWeeks === 1 ? "" : "s"} before cash runs out` : `Runway: ${f.runwayWeeks > 52 ? "52+" : f.runwayWeeks} weeks`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="13-week cash balance" className="lg:col-span-2"><BalanceChart f={f} /></Card>
        <Card title="Alerts" testId="cash-alerts">
          {alerts.length === 0 ? <p className="text-sm text-ink-muted">Nothing needs action.</p> : (
            <ul className="space-y-2">{alerts.map((a, i) => (
              <li key={i} className={cn("rounded-lg border-l-4 bg-muted/40 px-2.5 py-2 text-sm text-ink", a.tone === "red" ? "border-red-600" : a.tone === "amber" ? "border-amber-500" : "border-sky-500")}>
                {a.text}{a.tab && <button className="ml-1 text-xs font-semibold text-[#1590d6] underline" onClick={() => setTab(a.tab!)}>Open</button>}
              </li>))}</ul>)}
        </Card>
      </div>

      <Inflows data={data} today={today} />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Money in vs going out, per week" className="lg:col-span-2">
          <FlowBars f={f} />
          <p className="mt-1 text-xs text-ink-muted">13 weeks: in {rand0(f.totals.inExpected)} · units & materials {rand0(f.totals.units)} · overheads {rand0(f.totals.overheads)} · VAT {rand0(f.totals.vat)}{f.unscheduled.count > 0 && <> · <span className="font-semibold text-amber-700" data-testid="cash-unscheduled">Unscheduled finals {rand0(f.unscheduled.total)} ({f.unscheduled.count}) not in the weeks</span></>}</p>
        </Card>
        <Card title="VAT to SARS" testId="cash-vat" right={<span className="text-xs text-ink-muted">VAT {data.settings.vat_number || "–"}</span>}>
          <div className="text-xs text-ink-muted">Period {fmtD(vs.period.start)} – {fmtD(vs.period.end)} · {data.settings.vat_basis === "payment" ? "payment" : "invoice"} basis</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-secondary">VAT collected so far</dt><dd className="font-semibold">{rand0(vs.collectedSoFar)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-secondary">Less VAT on purchases so far</dt><dd>{rand0(vs.inputSoFar)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1"><dt className="text-ink-secondary">VAT expected to be owed</dt><dd className="text-lg font-semibold">{rand0(vs.expectedOwed)}</dd></div>
            <div className="flex justify-between text-xs text-ink-muted"><dt>Due to SARS</dt><dd>{fmtD(vs.period.due)}</dd></div>
            {vs.previous && <div className="flex justify-between text-xs text-ink-muted"><dt>Previous period, due {fmtD(vs.previous.period.due)}</dt><dd>{rand0(vs.previous.owed)}</dd></div>}
          </dl>
          <p className="mt-2 text-xs text-ink-muted">Included in the forecast as a payment in the due week.</p>
        </Card>
      </div>

      <Card title="Overheads" right={<button className="text-xs font-semibold text-[#1590d6]" onClick={() => setTab("settings")}>Edit</button>}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          {data.overheads.filter((o) => o.active).map((o) => (
            <div key={o.id} className="flex justify-between gap-2"><span className="truncate text-ink-secondary">{o.name}</span><span className="whitespace-nowrap">{rand0(o.amount)}{o.frequency === "weekly" ? "/wk" : o.frequency === "monthly" ? "/mo" : ""}</span></div>))}
        </div>
        <div className="mt-2 text-xs text-ink-muted">About {rand0(f.monthlyOverheads)} a month ({rand0(f.monthlyOverheads * 12 / 52)} a week)</div>
      </Card>

      <details className="rounded-2xl border border-border bg-card p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">Week by week</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr className="text-left text-ink-muted"><th className="py-1">Week</th><th className="text-right">In</th><th className="text-right">Units</th><th className="text-right">Overheads</th><th className="text-right">VAT</th><th className="text-right">Balance</th><th className="text-right">Cautious</th></tr></thead>
            <tbody>{f.weeks.map((w, i) => (
              <tr key={w.start} className="border-t border-border" title={w.lines.map((l) => `${l.kind === "in" ? "+" : "−"} ${rand0(l.amount)} ${l.label}`).join("\n")}>
                <td className="py-1">W{i + 1} · {w.label}</td><td className="text-right text-emerald-700 dark:text-emerald-300">{w.inExpected ? rand0(w.inExpected) : "–"}</td>
                <td className="text-right text-orange-700 dark:text-orange-300">{w.units ? rand0(w.units) : "–"}</td><td className="text-right">{w.overheads ? rand0(w.overheads) : "–"}</td>
                <td className="text-right">{w.vat ? rand0(w.vat) : "–"}</td><td className={cn("text-right font-semibold", w.balance < 0 && "text-red-600 dark:text-red-300")}>{rand0(w.balance)}</td>
                <td className={cn("text-right", w.balanceCautious < 0 && "text-red-600 dark:text-red-300")}>{rand0(w.balanceCautious)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------------- Money in ----------------
const STATUS_OPTS: { value: Receipt["status"]; label: string }[] = [{ value: "expected", label: "Expected" }, { value: "received", label: "Received" }, { value: "written_off", label: "Written off" }];

/** 3d: one view of the whole position. Stock is an asset, not cash; the running-balance low point is ringed. */
function Summary({ data, f }: { data: CashHealthData; f: Forecast }) {
  const s = buildSummary(data, f);
  const h = HEALTH[f.health];
  const lowTone = f.lowest.value < 0 ? "red" : f.lowest.value < f.buffer ? "amber" : "green";
  const cell = (label: string, value: string, sub?: string, cls?: string, id?: string) => (
    <div className={cn("min-w-0 rounded-xl bg-muted/40 px-2.5 py-2", cls)} data-testid={id}>
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="truncate text-base font-semibold text-ink">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-muted">{sub}</div>}
    </div>);
  return (
    <Card testId="cash-summary">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><span className={cn("h-6 w-6 rounded-full", h.dot)} data-testid="cash-summary-light" /><span className={cn("text-lg font-semibold", h.text)}>{h.label}</span></div>
        <div className={cn("ml-auto rounded-xl border-2 px-3 py-1.5 text-right", lowTone === "red" ? "border-red-600 bg-red-50 dark:bg-red-500/10" : lowTone === "amber" ? "border-amber-500 bg-amber-50 dark:bg-amber-500/10" : "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10")} data-testid="cash-summary-low">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Lowest bank balance</div>
          <div className={cn("text-2xl font-bold", lowTone === "red" ? "text-red-700" : lowTone === "amber" ? "text-amber-700" : "text-emerald-700")}>{rand0(s.low.value)}</div>
          <div className="text-[11px] text-ink-muted">week of {s.low.week}</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
        {cell("Bank", s.bankEntered ? rand0(s.bank) : "Not entered", f.bankAsOf ? `as of ${fmtD(f.bankAsOf)}` : undefined, undefined, "cash-sum-bank")}
        {cell("Stock value", rand0(s.stock), "asset, not cash · cost excl VAT", undefined, "cash-sum-stock")}
        {cell("Job liabilities", rand0(s.liabilities.total), `${s.liabilities.jobs} deposited jobs · ${s.liabilities.lines} lines to buy`, undefined, "cash-sum-liab")}
        {cell("Deposits paid", rand0(s.depositsPaid), `${rand0(s.depositsExpected)} still expected`, undefined, "cash-sum-deposits")}
        {cell("Finals expected", rand0(s.finalsExpected), f.unscheduled.count ? `${rand0(f.unscheduled.total)} unscheduled` : undefined, undefined, "cash-sum-finals")}
        {cell("Overheads", `${rand0(s.overheadsMonth)}/mo`, undefined, undefined, "cash-sum-overheads")}
        {cell("VAT next", s.vatNext ? rand0(s.vatNext.amount) : "R0", s.vatNext ? `due ${fmtD(s.vatNext.date)}` : undefined, undefined, "cash-sum-vat")}
        {cell("Cash after 13 wks", rand0(f.closing), undefined, f.closing < 0 ? "ring-1 ring-red-600" : undefined, "cash-sum-closing")}
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1" data-testid="cash-summary-weeks">
        {f.weeks.map((w, i) => {
          const isLow = i === f.lowest.index;
          return (
            <div key={w.start} className={cn("min-w-[68px] flex-1 rounded-lg px-1.5 py-1 text-center", isLow ? "border-2 border-red-600 bg-red-50 dark:bg-red-500/10" : "bg-muted/40")} data-testid={isLow ? "cash-week-low" : undefined}>
              <div className="text-[10px] text-ink-muted">W{i + 1} · {w.label}</div>
              <div className={cn("text-xs font-semibold", w.balance < 0 ? "text-red-700" : w.balance < f.buffer ? "text-amber-700" : "text-ink")}>{rand0(w.balance)}</div>
              {isLow && <div className="text-[9px] font-bold uppercase text-red-700">Low point</div>}
            </div>);
        })}
      </div>
    </Card>
  );
}

function Inflows({ data, today }: { data: CashHealthData; today: Date }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const rows = useMemo(() => inflowSeries(data, today, mode), [data, today, mode]);
  const tot = rows.reduce((t, b) => ({ d: t.d + b.deposits, f: t.f + b.finals, r: t.r + b.received }), { d: 0, f: 0, r: 0 });
  return (
    <Card title={`Money in, per ${mode}`} testId="cash-inflows" right={
      <div className="flex rounded-full border border-border p-0.5 text-xs" role="tablist">
        {(["week", "month"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} data-testid={`cash-inflows-${m}`} onClick={() => setMode(m)}
          className={cn("h-9 rounded-full px-3 font-semibold", mode === m ? "bg-[#E8F6FE] text-[#1590d6]" : "text-ink-muted")}>{m === "week" ? "Week" : "Month"}</button>)}
      </div>}>
      <InflowChart rows={rows} />
      <p className="mt-1 text-xs text-ink-muted">Deposits expected {rand0(tot.d)} · finals expected {rand0(tot.f)} · received {rand0(tot.r)}. Overdue expected money shows in the current {mode}; unscheduled finals are left out.</p>
    </Card>
  );
}

function MoneyIn({ data, f, actions, safe, today }: { data: CashHealthData; f: Forecast; actions: CashHealthActions; safe: Safe; today: Date }) {
  const t = isoDate(today);
  const inv = new Map(data.invoices.map((i) => [i.id, i]));
  const open = data.receipts.filter((r) => r.status === "expected");
  const recent = data.receipts.filter((r) => r.status !== "expected" && (r.received_date ?? "") >= isoDate(new Date(today.getTime() - 60 * 86400000)));
  const cautious = f.weeks.reduce((s, w) => s + w.inCautious, 0);
  const [add, setAdd] = useState<{ ref: string; client: string; amount: string; date: string; part: Receipt["part"]; confidence: string } | null>(null);
  const row = (r: Receipt) => {
    const i = r.invoice_id ? inv.get(r.invoice_id) : null;
    const late = r.status === "expected" && r.expected_date && new Date(r.expected_date + "T00:00:00").getTime() + r.leeway_days * 86400000 < new Date(t + "T00:00:00").getTime();
    return (
      <div key={r.id} className="grid grid-cols-2 items-center gap-2 border-t border-border py-2 text-sm md:grid-cols-[1.6fr_.9fr_1fr_.7fr_.7fr_1fr_auto]" data-testid="cash-receipt-row">
        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="truncate font-semibold text-ink">{r.ref} <span className="font-normal text-ink-secondary">{r.client}</span></div>
          <div className="flex flex-wrap gap-1"><Chip tone="blue">{PART_LABEL[r.part]}</Chip>{i?.status === "draft" && <Chip tone="amber">Draft – not sent</Chip>}{r.source !== "field_lynk" && <Chip>Added by hand</Chip>}{late && <Chip tone="red">Overdue</Chip>}{r.status === "expected" && !r.expected_date && <Chip tone="amber">Unscheduled – date not set</Chip>}{r.note && <span className="text-xs text-ink-muted">{r.note}</span>}</div>
        </div>
        <div className="text-right font-semibold md:text-left">{rand0(r.amount_incl)}</div>
        <Field ariaLabel="Expected date" type="date" value={r.expected_date} onSave={(v) => safe(actions.updateReceipt(r.id, { expected_date: v || null }), "Date saved")} />
        <Field ariaLabel="Leeway days" type="number" value={r.leeway_days} suffix="d" onSave={(v) => safe(actions.updateReceipt(r.id, { leeway_days: Math.max(0, Math.round(n(v))) }))} />
        <Field ariaLabel="Confidence" type="number" value={r.confidence} suffix="%" onSave={(v) => safe(actions.updateReceipt(r.id, { confidence: Math.min(100, Math.max(0, Math.round(n(v)))) }))} />
        <Pick ariaLabel="Status" value={r.status} options={STATUS_OPTS} onChange={(v) => safe(actions.updateReceipt(r.id, { status: v, received_date: v === "received" ? t : null, received_amount: v === "received" ? r.amount_incl : null } as Partial<Receipt>))} />
        <div className="flex justify-end">{r.source !== "field_lynk" && <button aria-label="Delete" className="p-1 text-ink-muted hover:text-red-600" onClick={() => safe(actions.deleteReceipt(r.id))}><Trash2 className="h-4 w-4" /></button>}</div>
      </div>);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Expected in 13 weeks" value={rand0(f.totals.inExpected)} tone="green" sub={f.unscheduled.count ? `+ ${rand0(f.unscheduled.total)} unscheduled (${f.unscheduled.count}, no date yet)` : undefined} testId="cash-in-expected" />
        <Stat label="Cautious (late + confidence)" value={rand0(cautious)} />
        <Stat label="Open payments" value={String(open.length)} sub={`${open.filter((r) => r.invoice_id && inv.get(r.invoice_id)?.status === "draft").length} on draft invoices`} />
        <Stat label="Received (last 60 days)" value={rand0(recent.filter((r) => r.status === "received").reduce((s, r) => s + r.amount_incl, 0))} />
      </div>
      <Card title="Expected money in" right={<Btn variant="ghost" onClick={() => setAdd({ ref: "", client: "", amount: "", date: t, part: "full", confidence: "60" })}><Plus className="h-4 w-4" />Add</Btn>} testId="cash-receipts">
        <p className="text-xs text-ink-muted">Every invoice is split into its deposit and final. Change the date, leeway (days late you allow) or confidence on any row; your changes stick.</p>
        <div className="mt-1 hidden grid-cols-[1.6fr_.9fr_1fr_.7fr_.7fr_1fr_auto] gap-2 text-xs text-ink-muted md:grid"><span>Invoice · client</span><span>Amount</span><span>Expected</span><span>Leeway</span><span>Confidence</span><span>Status</span><span /></div>
        {add && (
          <div className="my-2 grid grid-cols-2 gap-2 rounded-xl border border-dashed border-[#1590d6] p-2 md:grid-cols-6">
            <Field ariaLabel="Reference" value={add.ref} placeholder="Ref (e.g. 0010017)" onSave={(v) => setAdd({ ...add, ref: v })} />
            <Field ariaLabel="Client" value={add.client} placeholder="Client" onSave={(v) => setAdd({ ...add, client: v })} />
            <Field ariaLabel="Amount" type="number" prefix="R" value={add.amount} placeholder="Amount incl VAT" onSave={(v) => setAdd({ ...add, amount: v })} />
            <Field ariaLabel="Expected date" type="date" value={add.date} onSave={(v) => setAdd({ ...add, date: v })} />
            <Pick ariaLabel="Part" value={add.part} options={(["deposit", "final", "full"] as const).map((p) => ({ value: p, label: PART_LABEL[p] }))} onChange={(v) => setAdd({ ...add, part: v })} />
            <div className="flex gap-1"><Btn disabled={!add.ref || n(add.amount) <= 0} onClick={() => { safe(actions.addReceipt({ ref: add.ref, client: add.client, amount_incl: n(add.amount), expected_date: add.date, part: add.part, confidence: 60, leeway_days: data.settings.default_leeway_days }), "Added"); setAdd(null); }}>Add</Btn><Btn variant="outline" onClick={() => setAdd(null)}>Cancel</Btn></div>
          </div>)}
        {open.length === 0 ? <p className="py-3 text-sm text-ink-muted">No open payments.</p> : open.map(row)}
      </Card>
      {recent.length > 0 && <Card title="Received or written off (last 60 days)">{recent.map(row)}</Card>}
    </div>
  );
}

// ---------------- Projects ----------------
const CS_OPTS = (Object.keys(COMMIT_STATUS) as CommitStatus[]).map((k) => ({ value: k, label: COMMIT_STATUS[k] }));
const csTone = (s: string) => (s === "needed" ? "red" : s === "ordered_paid" ? "amber" : s === "in_stock" ? "blue" : s === "installed" ? "green" : "grey") as "red" | "amber" | "blue" | "green" | "grey";

function ProjectCard({ p, data, actions, safe }: { p: ProjectRow; data: CashHealthData; actions: CashHealthActions; safe: Safe }) {
  const [open, setOpen] = useState(false);
  const [alloc, setAlloc] = useState<{ line: Commitment; stock: string; qty: string } | null>(null);
  const first = p.lines[0];
  const freeItems = data.stock.filter((s) => freeStock(s, data.allocations) > 0);
  return (
    <div className="rounded-xl border border-border" data-testid="cash-project">
      <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left" onClick={() => setOpen(!open)}>
        <span className="flex min-w-[180px] flex-1 items-center gap-1.5 font-semibold text-ink">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{p.ref} <span className="truncate font-normal text-ink-secondary">{p.label && p.label.toLowerCase() !== p.client.toLowerCase() ? `${p.label} · ${p.client}` : p.client}</span></span>
        <span className="text-xs text-ink-muted">Value <b className="text-ink">{rand0(p.invoiceValue)}</b></span>
        <span className="text-xs text-ink-muted">Deposit <b className="text-ink">{p.deposit ? rand0(p.deposit.amount) : "–"}</b> {p.deposit && <Chip tone={p.deposit.received ? "green" : "amber"}>{p.deposit.received ? "Received" : `Expected ${fmtD(p.deposit.date)}`}</Chip>}</span>
        <span className="text-xs text-ink-muted">Final {p.final ? <>{fmtD(p.final.date)} {p.final.received && <Chip tone="green">Received</Chip>}</> : "–"}</span>
        <span className="text-xs text-ink-muted">Still to buy <b className="text-ink">{rand0(p.stillToBuy)}</b></span>
        {p.stockCovered > 0 && <span className="text-xs text-ink-muted">From stock <b className="text-ink">{rand0(p.stockCovered)}</b></span>}
        <Chip tone={csTone(p.status)}>{p.status === "mixed" ? "Mixed" : p.status === "none" ? "No units" : COMMIT_STATUS[p.status]}</Chip>
        <span className={cn("ml-auto text-sm font-semibold", p.cover < -0.5 ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>{rand0(p.cover)}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-border p-3">
          {p.lines.map((l) => {
            const al = data.allocations.filter((a) => a.commitment_id === l.id);
            return (
              <div key={l.id} className="grid grid-cols-2 items-center gap-2 border-b border-border/60 py-2 text-sm last:border-0 md:grid-cols-[2fr_.5fr_1fr_1fr_1fr_1.1fr_auto]">
                <div className="col-span-2 min-w-0 md:col-span-1"><div className="truncate text-ink" title={l.item}>{l.item}</div><div className="text-xs text-ink-muted">{l.supplier || "Supplier not set"}{al.length > 0 && ` · ${al.reduce((s, a) => s + a.qty, 0)} from stock${al.some((a) => a.drawn_at) ? " (drawn)" : ""}`}</div></div>
                <Field ariaLabel="Qty" type="number" value={l.qty} onSave={(v) => safe(actions.updateCommitment(l.id, { qty: Math.max(0.01, n(v)) }))} />
                <Field ariaLabel="Cost each excl VAT" type="number" prefix="R" value={l.unit_cost_excl} onSave={(v) => safe(actions.updateCommitment(l.id, { unit_cost_excl: Math.max(0, n(v)) }), "Cost saved")} />
                <div className="text-right text-xs text-ink-muted md:text-left">{rand0(l.qty * unitCostIncl(l))} incl<div>{stillToPay(l, data.allocations) > 0 ? `to pay ${rand0(stillToPay(l, data.allocations))}` : "nothing to pay"}</div></div>
                <Field ariaLabel="Pay date" type="date" value={l.pay_date} onSave={(v) => safe(actions.updateCommitment(l.id, { pay_date: v || null }))} />
                <Pick ariaLabel="Status" value={l.status} options={CS_OPTS} onChange={(v) => safe(actions.updateCommitment(l.id, v === "ordered_paid" ? { status: v, pay_date: isoDate(new Date()) } : { status: v }), v === "installed" ? "Installed – stock drawn down" : undefined)} />
                <div className="flex justify-end gap-1">
                  {l.status !== "installed" && freeItems.length > 0 && <Btn variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAlloc({ line: l, stock: freeItems[0].id, qty: String(Math.max(1, l.qty - al.reduce((s, a) => s + a.qty, 0))) })}>Use stock</Btn>}
                  {al.filter((a) => !a.drawn_at).map((a) => <Btn key={a.id} variant="ghost" className="h-8 px-2 text-xs" onClick={() => safe(actions.unallocate(a.id), "Stock released")}>Release</Btn>)}
                  {!l.source_key && <button aria-label="Delete line" className="p-1 text-ink-muted hover:text-red-600" onClick={() => safe(actions.deleteCommitment(l.id))}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>);
          })}
          {alloc && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2 text-sm">
              <span>Use stock for <b>{alloc.line.item}</b>:</span>
              <Pick ariaLabel="Stock item" className="w-auto min-w-[200px]" value={alloc.stock} options={freeItems.map((s) => ({ value: s.id, label: `${s.item} (${freeStock(s, data.allocations)} free)` }))} onChange={(v) => setAlloc({ ...alloc, stock: v })} />
              <Field ariaLabel="Qty" type="number" className="w-20" value={alloc.qty} onSave={(v) => setAlloc({ ...alloc, qty: v })} />
              <Btn onClick={() => { safe(actions.allocate(alloc.line.id, alloc.stock, n(alloc.qty)), "Stock allocated"); setAlloc(null); }}>Allocate</Btn>
              <Btn variant="outline" onClick={() => setAlloc(null)}>Cancel</Btn>
            </div>)}
          <Btn variant="ghost" className="text-xs" onClick={() => safe(actions.addCommitment({ invoice_id: first?.invoice_id ?? null, quote_id: first?.quote_id ?? null, job_id: first?.job_id ?? null, project: first?.project ?? `${p.ref} ${p.client}`, item: "Materials allowance", kind: "material", qty: 1, unit_cost_excl: 0, pay_date: first?.pay_date ?? null }), "Line added – fill in the cost")}><Plus className="h-4 w-4" />Add materials / other cost</Btn>
        </div>)}
    </div>
  );
}

function Projects({ data, actions, safe }: { data: CashHealthData; actions: CashHealthActions; safe: Safe }) {
  const rows = useMemo(() => buildProjects(data), [data]);
  const active = rows.filter((p) => p.status !== "installed");
  const done = rows.filter((p) => p.status === "installed");
  const sum = (k: "stillToBuy" | "cover") => active.reduce((s, p) => s + p[k], 0);
  const deps = active.reduce((s, p) => s + (p.deposit?.amount ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Deposits (open jobs)" value={rand0(deps)} />
        <Stat label="Units & materials still to buy" value={rand0(sum("stillToBuy"))} tone="amber" sub={`Supplier cost = list × ${Number(data.settings.unit_cost_factor).toFixed(2)}`} />
        <Stat label="Deposit − still to buy" value={rand0(sum("cover"))} tone={sum("cover") < 0 ? "red" : "green"} sub="Negative = deposits don't cover the stock" />
        <Stat label="Jobs" value={String(active.length)} sub={`${active.filter((p) => p.cover < -0.5).length} not covered`} />
      </div>
      <Card title="Projects: what each job still needs" testId="cash-projects">
        <p className="mb-2 text-xs text-ink-muted">Tap a job to see its units. Mark them Ordered / paid → In stock → Installed. Samsung (Fourways) is paid on the order date, so set the pay date to when you order.</p>
        <div className="space-y-2">{active.length === 0 ? <p className="text-sm text-ink-muted">No open jobs with units to buy.</p> : active.map((p) => <ProjectCard key={p.key} p={p} data={data} actions={actions} safe={safe} />)}</div>
      </Card>
      {done.length > 0 && <Card title="Installed">{done.map((p) => <ProjectCard key={p.key} p={p} data={data} actions={actions} safe={safe} />)}</Card>}
    </div>
  );
}

// ---------------- Stock ----------------
type TakeRow = { id?: string; item: string; model_code: string; qty: string; unit_cost_excl: string; location: string };
function Stock({ data, actions, safe }: { data: CashHealthData; actions: CashHealthActions; safe: Safe }) {
  const [take, setTake] = useState<TakeRow[] | null>(null);
  const [clean, setClean] = useState(true);
  const commitById = new Map(data.commitments.map((c) => [c.id, c]));
  const blank = (): TakeRow => ({ item: "", model_code: "", qty: "", unit_cost_excl: "", location: "" });
  const startTake = () => setTake([...data.stock.map((s) => ({ id: s.id, item: s.item, model_code: s.model_code ?? "", qty: "", unit_cost_excl: String(s.unit_cost_excl || ""), location: s.location ?? "" })), blank(), blank(), blank()]);
  const setRow = (i: number, patch: Partial<TakeRow>) => setTake((t) => { if (!t) return t; const x = [...t]; x[i] = { ...x[i], ...patch }; if (i === x.length - 1 && patch.item) x.push(blank()); return x; });
  if (take) return (
    <Card title="Stock-take" testId="cash-stocktake" right={<span className="text-xs text-ink-muted">Count what's on the shelf</span>}>
      <p className="mb-2 text-xs text-ink-muted">Type the count for each item. Add new items in the empty rows. Cost is your supplier cost each, excl VAT.</p>
      <div className="hidden grid-cols-[2fr_1.2fr_.6fr_1fr_1fr] gap-2 text-xs text-ink-muted md:grid"><span>Item</span><span>Model</span><span>Count</span><span>Cost each excl</span><span>Location</span></div>
      <div className="space-y-2">{take.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 border-t border-border pt-2 md:grid-cols-[2fr_1.2fr_.6fr_1fr_1fr] md:border-0 md:pt-0">
          <Field className="col-span-2 md:col-span-1" ariaLabel="Item" value={r.item} placeholder="Item (e.g. Samsung 12K AR40)" onSave={(v) => setRow(i, { item: v })} />
          <Field ariaLabel="Model" value={r.model_code} placeholder="Model code" onSave={(v) => setRow(i, { model_code: v })} />
          <Field ariaLabel="Count" type="number" value={r.qty} placeholder="0" onSave={(v) => setRow(i, { qty: v })} />
          <Field ariaLabel="Cost" type="number" prefix="R" value={r.unit_cost_excl} onSave={(v) => setRow(i, { unit_cost_excl: v })} />
          <Field ariaLabel="Location" value={r.location} placeholder="Workshop / van" onSave={(v) => setRow(i, { location: v })} />
        </div>))}</div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />Clean slate: anything I didn't count is set to 0</label>
      <div className="mt-3 flex gap-2">
        <Btn testId="cash-stocktake-save" onClick={() => { safe(actions.stockTake(take.filter((r) => r.item.trim() && r.qty.trim() !== "").map((r) => ({ id: r.id, item: r.item, model_code: r.model_code, qty: n(r.qty), unit_cost_excl: r.unit_cost_excl ? n(r.unit_cost_excl) : undefined, location: r.location })), clean), "Stock-take saved"); setTake(null); }}>Save count</Btn>
        <Btn variant="outline" onClick={() => setTake(null)}>Cancel</Btn>
      </div>
    </Card>
  );
  const last = data.stock.reduce<string | null>((m, s) => (s.last_counted_at && (!m || s.last_counted_at > m) ? s.last_counted_at : m), null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Stock value (cost excl)" value={rand0(stockValue(data.stock))} sub="An asset, not cash" />
        <Stat label="Items" value={String(data.stock.filter((s) => s.qty_on_hand > 0).length)} />
        <Stat label="Allocated to jobs" value={String(data.allocations.filter((a) => !a.drawn_at).reduce((s, a) => s + a.qty, 0))} sub="units reserved" />
        <Stat label="Last stock-take" value={last ? fmtD(last) : "Never"} tone={last ? undefined : "amber"} />
      </div>
      <Card title="Stock on hand" testId="cash-stock" right={<Btn testId="cash-stocktake-start" onClick={startTake}>Stock-take</Btn>}>
        {data.stock.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink-muted">No stock entered yet. Tap <b>Stock-take</b> to count what's on hand, starting from a clean slate.</div>
        ) : (
          <div>
            <div className="hidden grid-cols-[2fr_.6fr_.6fr_1fr_1fr_1fr] gap-2 text-xs text-ink-muted md:grid"><span>Item</span><span>On hand</span><span>Free</span><span>Cost each excl</span><span>Location</span><span className="text-right">Value</span></div>
            {data.stock.map((s) => {
              const al = data.allocations.filter((a) => a.stock_item_id === s.id && !a.drawn_at);
              return (
                <div key={s.id} className="grid grid-cols-3 items-center gap-2 border-t border-border py-2 text-sm md:grid-cols-[2fr_.6fr_.6fr_1fr_1fr_1fr]">
                  <div className="col-span-3 min-w-0 md:col-span-1"><div className="truncate font-semibold text-ink">{s.item}</div><div className="text-xs text-ink-muted">{s.model_code}{al.length > 0 && ` · for ${al.map((a) => commitById.get(a.commitment_id)?.project.split(" ")[0] ?? "job").join(", ")}`}</div></div>
                  <div>{s.qty_on_hand}</div><div className={cn(freeStock(s, data.allocations) <= 0 && "text-ink-muted")}>{freeStock(s, data.allocations)} free</div>
                  <Field ariaLabel="Cost each" type="number" prefix="R" value={s.unit_cost_excl} onSave={(v) => safe(actions.updateStock(s.id, { unit_cost_excl: Math.max(0, n(v)) }))} />
                  <Field ariaLabel="Location" value={s.location} onSave={(v) => safe(actions.updateStock(s.id, { location: v || null }))} />
                  <div className="text-right">{rand0(s.qty_on_hand * s.unit_cost_excl)}</div>
                </div>);
            })}
          </div>)}
        <p className="mt-2 flex items-start gap-1 text-xs text-ink-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Allocate stock to a job under Projects → Use stock. That job then needs no cash for it, and the stock is drawn down when the job is installed.</p>
      </Card>
    </div>
  );
}

// ---------------- Settings ----------------
const FREQ: { value: Overhead["frequency"]; label: string }[] = [{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "annual", label: "Yearly" }, { value: "once", label: "Once" }];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Settings({ data, f, actions, safe, today }: { data: CashHealthData; f: Forecast; actions: CashHealthActions; safe: Safe; today: Date }) {
  const s = data.settings;
  const accts = latestBalances(data.accounts, data.balances);
  const [bal, setBal] = useState<Record<string, string>>({});
  const [newAcc, setNewAcc] = useState<{ label: string; ref: string } | null>(null);
  const set = (patch: Partial<typeof s>) => safe(actions.saveSettings(patch), "Saved");
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Bank balance" testId="cash-settings-bank" right={<Btn variant="ghost" onClick={() => setNewAcc({ label: "", ref: "" })}><Plus className="h-4 w-4" />Account</Btn>}>
        <p className="mb-2 text-xs text-ink-muted">Type the balance each Monday. The forecast starts from the latest balance of each ticked account.</p>
        {accts.map(({ account: a, balance, as_of }) => (
          <div key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-border py-2 text-sm">
            <div><div className="font-semibold text-ink">{a.label} <span className="font-normal text-ink-muted">{a.account_ref}</span></div>
              <div className="text-xs text-ink-muted">{balance === null ? "No balance yet" : `${rand0(balance)} on ${fmtD(as_of)}`}</div>
              <label className="mt-1 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={a.include} onChange={(e) => safe(actions.updateAccount(a.id, { include: e.target.checked }))} />Count in forecast</label></div>
            <div className="flex gap-1.5"><Field ariaLabel={`Balance ${a.label}`} className="w-36" type="number" prefix="R" value={bal[a.id] ?? ""} placeholder="Today's balance" onSave={(v) => setBal({ ...bal, [a.id]: v })} />
              <Btn disabled={!(bal[a.id] ?? "").trim()} onClick={() => { safe(actions.saveBalance(a.id, n(bal[a.id]), isoDate(today)), "Balance saved"); setBal({ ...bal, [a.id]: "" }); }}>Save</Btn></div>
          </div>))}
        {newAcc && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-2">
            <Field ariaLabel="Account name" value={newAcc.label} placeholder="Name (e.g. Online sales)" onSave={(v) => setNewAcc({ ...newAcc, label: v })} className="flex-1" />
            <Field ariaLabel="Account number" value={newAcc.ref} placeholder="…last digits" onSave={(v) => setNewAcc({ ...newAcc, ref: v })} className="w-32" />
            <Btn disabled={!newAcc.label.trim()} onClick={() => { safe(actions.addAccount(newAcc.label.trim(), newAcc.ref.trim()), "Account added"); setNewAcc(null); }}>Add</Btn>
          </div>)}
      </Card>

      <Card title="Overheads" testId="cash-settings-overheads" right={<Btn variant="ghost" onClick={() => safe(actions.saveOverhead({ name: "New overhead", category: "other", amount: 0, frequency: "monthly", pay_day: 1, sort: 99 }))}><Plus className="h-4 w-4" />Add</Btn>}>
        <p className="mb-2 text-xs text-ink-muted">Recurring costs. Weekly items are paid on the weekday you pick; monthly on the day of the month.</p>
        {data.overheads.map((o) => (
          <div key={o.id} className="grid grid-cols-2 items-center gap-2 border-t border-border py-2 text-sm md:grid-cols-[1.4fr_1fr_.9fr_.8fr_auto]">
            <Field className="col-span-2 md:col-span-1" ariaLabel="Name" value={o.name} onSave={(v) => v.trim() && safe(actions.saveOverhead({ id: o.id, name: v.trim() }))} />
            <Field ariaLabel="Amount" type="number" prefix="R" value={o.amount} onSave={(v) => safe(actions.saveOverhead({ id: o.id, amount: Math.max(0, n(v)) }), "Saved")} />
            <Pick ariaLabel="How often" value={o.frequency} options={FREQ} onChange={(v) => safe(actions.saveOverhead({ id: o.id, frequency: v, pay_day: v === "weekly" ? 5 : 1 }))} />
            {o.frequency === "weekly" ? <Pick ariaLabel="Pay day" value={String(o.pay_day ?? 5)} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} onChange={(v) => safe(actions.saveOverhead({ id: o.id, pay_day: Number(v) }))} />
              : o.frequency === "monthly" ? <Field ariaLabel="Day of month" type="number" value={o.pay_day ?? 1} prefix="day" onSave={(v) => safe(actions.saveOverhead({ id: o.id, pay_day: Math.min(31, Math.max(1, Math.round(n(v)))) }))} />
              : <Field ariaLabel="Date" type="date" value={o.pay_date} onSave={(v) => safe(actions.saveOverhead({ id: o.id, pay_date: v || null }))} />}
            <div className="flex items-center justify-end gap-1">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={o.active} onChange={(e) => safe(actions.saveOverhead({ id: o.id, active: e.target.checked }))} />On</label>
              <button aria-label="Delete overhead" className="p-1 text-ink-muted hover:text-red-600" onClick={() => safe(actions.deleteOverhead(o.id))}><Trash2 className="h-4 w-4" /></button>
            </div>
            {o.note && <div className="col-span-2 -mt-1 text-xs text-ink-muted md:col-span-5">{o.note}</div>}
          </div>))}
        <div className="mt-2 text-xs text-ink-muted">Total about {rand0(f.monthlyOverheads)} a month.</div>
      </Card>

      <Card title="Forecast start" testId="cash-settings-start">
        <label className="text-xs text-ink-muted">Live forecast starts on<Field ariaLabel="Forecast start" type="date" value={s.forecast_start ?? null} onSave={(v) => set({ forecast_start: v || null })} /></label>
        <p className="mt-1 text-xs text-ink-muted">Before this date the forecast and opening bank balance are dated from it. Blank = start today.</p>
      </Card>

      <Card title="VAT" testId="cash-settings-vat">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="col-span-2 text-xs text-ink-muted">VAT number<Field ariaLabel="VAT number" value={s.vat_number} onSave={(v) => set({ vat_number: v.trim() || null })} /></label>
          <label className="text-xs text-ink-muted">Basis<Pick ariaLabel="VAT basis" value={s.vat_basis} options={[{ value: "invoice", label: "Invoice basis" }, { value: "payment", label: "Payment basis" }]} onChange={(v) => set({ vat_basis: v })} /></label>
          <label className="text-xs text-ink-muted">Period<Pick ariaLabel="VAT period" value={String(s.vat_period_months)} options={[{ value: "1", label: "Monthly" }, { value: "2", label: "Every 2 months" }, { value: "4", label: "Every 4 months" }, { value: "6", label: "Every 6 months" }, { value: "12", label: "Yearly" }]} onChange={(v) => set({ vat_period_months: Number(v) })} /></label>
          <label className="text-xs text-ink-muted">A period ends on<Field ariaLabel="Period end" type="date" value={s.vat_period_end} onSave={(v) => set({ vat_period_end: v || null })} /></label>
          <label className="text-xs text-ink-muted">Pay SARS on day<Field ariaLabel="Due day" type="number" value={s.vat_due_day} suffix="of next month" onSave={(v) => set({ vat_due_day: Math.min(28, Math.max(1, Math.round(n(v)))) })} /></label>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Current period {fmtD(f.vatSummary.period.start)} – {fmtD(f.vatSummary.period.end)}, due {fmtD(f.vatSummary.period.due)}.</p>
      </Card>

      <Card title="Forecast rules" testId="cash-settings-rules">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="text-xs text-ink-muted">Minimum cash (buffer)<Pick ariaLabel="Buffer" value={s.buffer_mode} options={[{ value: "overheads_month", label: "1 month of overheads" }, { value: "fixed", label: "A fixed amount" }]} onChange={(v) => set({ buffer_mode: v })} /></label>
          {s.buffer_mode === "fixed" ? <label className="text-xs text-ink-muted">Amount<Field ariaLabel="Buffer amount" type="number" prefix="R" value={s.buffer_amount} onSave={(v) => set({ buffer_amount: Math.max(0, n(v)) })} /></label> : <div className="self-end pb-2 text-xs text-ink-muted">= {rand0(f.buffer)}</div>}
          <label className="text-xs text-ink-muted">Supplier cost = list ×<Field ariaLabel="Cost factor" type="number" step="0.01" value={s.unit_cost_factor} onSave={(v) => n(v) > 0 && set({ unit_cost_factor: n(v) })} /></label>
          <label className="text-xs text-ink-muted">Leeway for late payments<Field ariaLabel="Leeway" type="number" suffix="days" value={s.default_leeway_days} onSave={(v) => set({ default_leeway_days: Math.max(0, Math.round(n(v))) })} /></label>
          <div className="col-span-2 mt-1 text-xs font-semibold text-ink">Default confidence for new payments</div>
          <label className="text-xs text-ink-muted">Invoice sent<Field ariaLabel="Sent" type="number" suffix="%" value={s.conf_sent} onSave={(v) => set({ conf_sent: Math.min(100, Math.max(0, Math.round(n(v)))) })} /></label>
          <label className="text-xs text-ink-muted">Overdue<Field ariaLabel="Overdue" type="number" suffix="%" value={s.conf_overdue} onSave={(v) => set({ conf_overdue: Math.min(100, Math.max(0, Math.round(n(v)))) })} /></label>
          <label className="text-xs text-ink-muted">Draft / not sent<Field ariaLabel="Draft" type="number" suffix="%" value={s.conf_draft} onSave={(v) => set({ conf_draft: Math.min(100, Math.max(0, Math.round(n(v)))) })} /></label>
          <label className="text-xs text-ink-muted">Final before install<Field ariaLabel="Final" type="number" suffix="%" value={s.conf_final_before_install} onSave={(v) => set({ conf_final_before_install: Math.min(100, Math.max(0, Math.round(n(v)))) })} /></label>
        </div>
        <p className="mt-2 flex items-start gap-1 text-xs text-ink-muted"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Health: red if cash goes below R0, amber if it dips under the buffer or late payments would take it below R0, otherwise green.</p>
      </Card>
    </div>
  );
}
