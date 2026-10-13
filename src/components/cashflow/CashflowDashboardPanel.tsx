import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatRand } from "@/utils/formatRand";
import { bankBalance, buildWeeks, overdue, normalizeCf, isEmptyCf } from "@/lib/cashflow";
import { useCashflowAccess, useCashflowData } from "@/hooks/useCashflow";
import CashflowChart from "./CashflowChart";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type PanelT = React.ComponentType<any>;
/** New-layout dashboard panel. Renders nothing unless the server says owner/admin (_cf_ok). */
export default function CashflowDashboardPanel({ Panel }: { Panel: PanelT }) {
  const { companyId, allowed } = useCashflowAccess();
  const cf = useCashflowData(companyId, !!allowed);
  const d = useMemo(() => normalizeCf(cf.data?.data), [cf.data]);
  const weeks = useMemo(() => { try { return cf.data ? buildWeeks(d, new Date(), 12, cf.data.depositPct) : []; } catch { return []; } }, [cf.data, d]);
  if (!allowed) return null;
  if (cf.isLoading) return null;
  if (cf.isError || !cf.data || isEmptyCf(d)) {
    return (
      <Panel title="Cash flow · next 12 weeks" testId="v7-cashflow">
        <div className="text-[12px] text-muted-foreground" data-testid="v7-cashflow-empty">
          {cf.isError ? "Cash flow couldn't load right now." : "No cash-flow data yet."} <Link to="/admin/cashflow" className="underline">Open Cash flow</Link>
        </div>
      </Panel>
    );
  }
  const bank = bankBalance(d);
  const inn = d.receivables.reduce((s, r) => s + Number(r.outstanding), 0);
  const out = d.payables.reduce((s, r) => s + Number(r.outstanding), 0) + d.open_pos.reduce((s, p) => s + Number(p.total), 0);
  const neg = weeks.find((w) => w.closing < 0);
  return (
    <Panel title="Cash flow · next 12 weeks" sub={bank.asOf ? `bank as of ${bank.asOf}` : "import an FNB statement for the real balance"} testId="v7-cashflow">
      <div className="mb-2 grid grid-cols-3 gap-2 text-[12px]">
        <Link to="/admin/cashflow"><div className="text-muted-foreground">Bank</div><div className="text-base font-bold">{formatRand(bank.total)}</div></Link>
        <Link to="/admin/cashflow"><div className="text-muted-foreground">Clients owe us</div><div className="text-base font-bold text-emerald-600">{formatRand(inn)}</div><div className="text-[10.5px] text-muted-foreground">{overdue(d.receivables).length} overdue</div></Link>
        <Link to="/admin/supplier-bills"><div className="text-muted-foreground">We owe</div><div className="text-base font-bold text-orange-600">{formatRand(out)}</div><div className="text-[10.5px] text-muted-foreground">{overdue(d.payables).length} overdue</div></Link>
      </div>
      {neg && <div className="mb-2 flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[12px] text-red-700 dark:bg-red-950/40 dark:text-red-200"><AlertTriangle className="h-3.5 w-3.5" />Below zero in the week of {neg.label}</div>}
      <CashflowChart weeks={weeks} withExpected={false} height={170} />
    </Panel>
  );
}
