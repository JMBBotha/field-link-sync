import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchCreditNotes } from "@/lib/creditNotes";
import { currentJhbMonth, fmtHomeRand, type AdminHomeCounts, type CountFigure, type HomeCredit, type HomeInvoice, type HomeJob, type HomePayment, type WorkKind } from "@/lib/adminHomeCount";
import { fmtRandShort } from "@/lib/quotePipeline";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import { formatRand } from "@/utils/formatRand";
import { cn } from "@/lib/utils";

/** Soft V8 pastels from the approved sketch. Not bright RGB. */
export const PIE_COLOURS = ["#7CC4F4", "#FDBA8C", "#86D9B5", "#C4B5FD"] as const;

export function InfoMark({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`info-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn("ml-1 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold italic leading-none opacity-90", className)}
    >
      i
    </button>
  );
}

function moneyText(n: number): string {
  return formatRand(n);
}

export function figureHeadline(f: CountFigure): string {
  if (f.unit === "jobs") return `${f.count} job${f.count === 1 ? "" : "s"}`;
  if (f.key === "waiting") return `${f.count} · ${moneyText(f.total)}`;
  return moneyText(f.total);
}

export function HowCountedSheet({ figure, onClose }: { figure: CountFigure; onClose: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80]" data-testid="how-counted-sheet" role="dialog" aria-modal="true" aria-label="How this was counted">
      <button type="button" aria-label="Dimmed home" className="absolute inset-0 bg-[#0F1B2A]/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white px-5 pb-6 pt-3 text-[#0F1B2A] shadow-[0_-6px_20px_rgba(0,0,0,.2)]">
        <div className="mx-auto mb-3 h-[5px] w-11 rounded-full bg-[#CBD5E1]" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">How this was counted</h2>
          <button type="button" data-testid="how-counted-close" onClick={onClose} className="rounded-lg border border-[#E3E8EF] px-2.5 py-1.5 text-[13px] font-bold">✕ Close</button>
        </div>
        <div className="mb-3 rounded-lg border-l-4 border-[#F97316] bg-[#FFF7ED] px-3 py-2.5 text-sm leading-relaxed">
          <b>{figure.title}: {figureHeadline(figure)}</b>
          <div>{figure.rule}</div>
        </div>
        <ul>
          {figure.lines.map((line) => (
            <li key={line.id} className="border-b border-[#E3E8EF]">
              <Link to={line.href} data-testid={`how-counted-line-${line.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-[#1478C8]" onClick={onClose}>
                <span className="min-w-0 flex-1">{line.label}</span>
                <b className="shrink-0 tabular-nums">{figure.unit === "jobs" ? "1" : moneyText(line.amount)}</b>
              </Link>
            </li>
          ))}
          {figure.lines.length === 0 && <li className="py-2 text-sm text-[#5B6B7F]">Nothing in this figure.</li>}
          <li className="flex items-center justify-between py-2.5 text-sm font-extrabold">
            <span>Total</span>
            <span className="tabular-nums">{figure.unit === "jobs" ? figure.count : moneyText(figure.total)}</span>
          </li>
        </ul>
        <button
          type="button"
          data-testid="how-counted-action"
          onClick={() => { onClose(); navigate(figure.actionHref); }}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-[10px] bg-[#C2410C] text-base font-bold text-white hover:bg-[#9A3412]"
        >
          {figure.actionLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function InvoicesWaitingCard({ figure, onOpen }: { figure: CountFigure; onOpen: () => void }) {
  const navigate = useNavigate();
  return (
    <section data-testid="admin-invoices-waiting" className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F97316] p-4 text-[#0F1B2A] shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold uppercase tracking-wide">Invoices waiting to send</div>
        <span className="inline-flex flex-wrap items-center text-[18px] font-extrabold leading-tight tabular-nums sm:text-[22px]">
          <button type="button" className="text-left" onClick={onOpen}>
            {figure.count} · {moneyText(figure.total)} <span className="text-[13px] font-semibold">incl. VAT</span>
          </button>
          <InfoMark label="How invoices waiting was counted" onClick={onOpen} />
        </span>
      </div>
      <button type="button" data-testid="admin-invoices-review" onClick={() => navigate(figure.actionHref)} className="min-h-[44px] rounded-[10px] bg-[#9A3412] px-5 text-[16px] font-bold text-white ring-2 ring-white/70 hover:bg-[#7C2D12]">Review &amp; send</button>
    </section>
  );
}

function Donut({ parts, center, sub, onSlice }: { parts: { key: string; value: number }[]; center: string; sub: string; onSlice: (key: string) => void }) {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" className="h-[112px] w-[112px] shrink-0" role="img" aria-label={`${center} ${sub}`}>
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF3F8" strokeWidth="7" />
      {sum > 0 && parts.map((p, i) => {
        if (!(p.value > 0)) return null;
        const pct = (p.value / sum) * 100;
        const dash = Math.max(pct - (parts.filter((x) => x.value > 0).length > 1 ? 0.6 : 0), 0.4);
        const gap = 100 - dash;
        const offset = 25 - acc;
        acc += pct;
        return (
          <circle
            key={p.key}
            cx="21" cy="21" r="15.915" fill="none"
            stroke={PIE_COLOURS[i % PIE_COLOURS.length]}
            strokeWidth="7"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={offset}
            className="cursor-pointer"
            onClick={() => onSlice(p.key)}
          >
            <title>{p.key}</title>
          </circle>
        );
      })}
      <text x="21" y="19.2" textAnchor="middle" fill="#0F1B2A" fontSize={center.length > 4 ? 5 : 7.4} fontWeight="800">{center}</text>
      <text x="21" y="24.2" textAnchor="middle" fill="#5B6B7F" fontSize="3.3">{sub}</text>
    </svg>
  );
}

function Legend({ rows, onOpen }: { rows: { key: string; label: string; value: string; colour: string }[]; onOpen: (key: string) => void }) {
  return (
    <div className="min-w-0 flex-1">
      {rows.map((row) => (
        <button key={row.key} type="button" onClick={() => onOpen(row.key)} className="flex w-full items-center gap-2 border-b border-[#F0F3F7] py-1.5 text-left text-[12.5px] last:border-b-0">
          <i className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: row.colour }} />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          <b className="shrink-0 tabular-nums">{row.value}</b>
        </button>
      ))}
    </div>
  );
}

export function AdminHomePies({ counts, onOpen }: { counts: AdminHomeCounts; onOpen: (figure: CountFigure) => void }) {
  const workRows = counts.workSlices.map((s) => ({
    key: s.key,
    label: s.label,
    value: String(s.figure.count),
    colour: PIE_COLOURS[["service", "installation", "move", "other"].indexOf(s.key) % PIE_COLOURS.length] || PIE_COLOURS[3],
  }));
  const moneyOrder = [
    { key: "waiting", label: "Waiting to send", total: counts.waiting.total, figure: counts.waiting },
    { key: "deposit", label: "Deposit due", total: counts.deposit.total, figure: counts.deposit },
    { key: "final", label: "Final due", total: counts.finalDue.total, figure: counts.finalDue },
    { key: "paid", label: "Paid this month", total: counts.paid.total, figure: counts.paid },
  ] as const;
  const openWork = (key: string) => {
    const slice = counts.workSlices.find((s) => s.key === key as WorkKind);
    onOpen(slice?.figure || counts.work);
  };
  const openMoney = (key: string) => onOpen(moneyOrder.find((m) => m.key === key)?.figure || counts.money);
  return (
    <div data-testid="admin-home-pies" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <section className="rounded-2xl border bg-card p-3.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <b className="text-sm">This month&apos;s work</b>
          <button type="button" className="text-xs font-semibold text-[#1590d6]" onClick={() => onOpen(counts.work)}>Tap a slice</button>
        </div>
        <div className="flex items-center gap-2.5">
          <Donut parts={counts.workSlices.map((s) => ({ key: s.key, value: s.figure.count }))} center={String(counts.work.count)} sub="jobs" onSlice={openWork} />
          <Legend rows={workRows} onOpen={openWork} />
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-3.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <b className="text-sm">Where the money sits</b>
          <span className="inline-flex items-center text-xs font-semibold text-[#1590d6]">
            <button type="button" onClick={() => onOpen(counts.money)}>incl. VAT</button>
            <InfoMark label="How the money total was counted" onClick={() => onOpen(counts.money)} />
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <Donut parts={moneyOrder.map((m) => ({ key: m.key, value: m.total }))} center={fmtRandShort(counts.money.total)} sub="tracked" onSlice={openMoney} />
          <Legend rows={moneyOrder.map((m, i) => ({ key: m.key, label: m.label, value: fmtHomeRand(m.total), colour: PIE_COLOURS[i] }))} onOpen={openMoney} />
        </div>
      </section>
    </div>
  );
}

function customerName(row: { customers?: { name?: string | null } | { name?: string | null }[] | null }): string {
  const c = row.customers;
  const name = Array.isArray(c) ? c[0]?.name : c?.name;
  return name || "Client";
}

/** Day before the Johannesburg month, so a 00:30 SAST job is not missed by a UTC lower bound. */
function jobQueryStart(now: Date): string {
  const month = currentJhbMonth(now);
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface AdminHomeSource {
  invoices: HomeInvoice[];
  payments: HomePayment[];
  credits: HomeCredit[];
  jobs: HomeJob[];
}

export function useAdminHomeFigures(companyId: string | null | undefined) {
  const month = todayInJohannesburg().slice(0, 7);
  const q = useQuery({
    queryKey: ["admin-home-figures", companyId, month],
    enabled: !!companyId && companyId !== "4ddd72cb-56b9-448a-a589-3490bbc464ae",
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminHomeSource> => {
      const start = jobQueryStart(new Date());
      const { data: invoices, error } = await (supabase.from("invoices") as any)
        .select("id, company_id, status, grand_total, notes, sent_at, archived_at, customer_name, invoice_number, quote_id, created_at, due_date, due_date_manual, due_date_source, expected_deposit_date, expected_final_date, final_unscheduled, issue_date")
        .eq("company_id", companyId)
        .limit(2000);
      if (error) throw error;
      const invRows = (invoices || []) as HomeInvoice[];
      const ids = invRows.map((i) => i.id);
      const [pays, credits, jobsRes] = await Promise.all([
        ids.length
          ? (supabase.from("payments") as any).select("id, invoice_id, company_id, amount, status, gateway, payment_date").in("invoice_id", ids)
          : Promise.resolve({ data: [], error: null }),
        fetchCreditNotes(ids),
        (supabase.from("jobs") as any)
          .select("id, company_id, job_type, title, status, scheduled_for, started_at, completed_at, created_at, customers(name)")
          .eq("company_id", companyId)
          .or(`scheduled_for.gte.${start},started_at.gte.${start},completed_at.gte.${start},created_at.gte.${start}`)
          .limit(2000),
      ]);
      if (pays.error) throw pays.error;
      if (jobsRes.error) throw jobsRes.error;
      const jobs: HomeJob[] = ((jobsRes.data || []) as any[]).map((j) => ({
        id: j.id, company_id: j.company_id, job_type: j.job_type, title: j.title, status: j.status,
        scheduled_for: j.scheduled_for, started_at: j.started_at, completed_at: j.completed_at, created_at: j.created_at,
        customer_name: customerName(j),
      }));
      return { invoices: invRows, payments: (pays.data || []) as HomePayment[], credits: credits as HomeCredit[], jobs };
    },
  });
  return useMemo(() => ({ source: q.data, isLoading: q.isLoading, isError: q.isError }), [q.data, q.isLoading, q.isError]);
}
