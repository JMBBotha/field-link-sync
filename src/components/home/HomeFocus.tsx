import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNextSteps } from "@/hooks/useNextSteps";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import { useNow } from "@/hooks/useLeadSla";
import { RULES, amountLabel, buttonTarget, cardTarget, urgency, type NextStep, type NextStepRule } from "@/lib/nextSteps";
import type { DueRow } from "@/lib/invoiceDue";

const r = (n: number | null) => (n == null ? "" : "R " + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " "));
/** Johan 2 Nov 17:51: sales first, then deposit, then booking, then final payment. */
const STAGE: Record<NextStepRule, number> = { new_lead: 0, no_quote: 0, followup: 0, cold: 0, deposit_invoice: 1, accepted_unbooked: 2, book_install: 2, assign_tech: 2, final_invoice: 3, final_unpaid: 3 };
const STAGE_LABEL = ["Sales", "Deposit", "Booking", "Final payment"];
const URG = { red: 0, orange: 1, green: 2 } as const;
const DOT = { green: "bg-[#22C55E]", orange: "bg-[#F59E0B]", red: "bg-[#EF4444]" };

export function orderSteps(rows: NextStep[], now = Date.now()): NextStep[] {
  return [...rows].sort((a, b) => STAGE[a.rule] - STAGE[b.rule] || URG[urgency(a, now)] - URG[urgency(b, now)] || (b.prio ?? 0) - (a.prio ?? 0));
}
export function owingTotals(rows: Pick<DueRow, "amount_due" | "days" | "waiting">[]) {
  let out = 0, late = 0, lateN = 0, wait = 0;
  for (const x of rows) { const a = Number(x.amount_due) || 0; out += a; if (x.waiting) wait += a; else if ((x.days ?? 0) > 0) { late += a; lateN++; } }
  return { out, late, lateN, wait, n: rows.length };
}

/** Pure view (harness + tests): one next-step card, the orange invoices-waiting card, then the rest in order. */
export function HomeFocusView({ steps, due, now = Date.now(), requests }: { steps: NextStep[]; due: Pick<DueRow, "amount_due" | "days" | "waiting">[]; now?: number; requests?: React.ReactNode }) {
  const navigate = useNavigate();
  const ordered = orderSteps(steps, now);
  const [top, ...rest] = ordered;
  const t = owingTotals(due);
  return (
    <div className="space-y-3" data-testid="home-focus">
      {/* Johan 2 Nov 18:25: V8 colours, not white. Navy-to-blue hero, glass cards, #3D9BEB accents. */}
      <section className="v8-navy rounded-2xl p-4 shadow-md" data-testid="home-next-step">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[#CFE6F6]">Your next step{top ? ` · ${STAGE_LABEL[STAGE[top.rule]]}` : ""}</p>
        {top ? (<>
          <p className="mt-1 flex items-center gap-2 text-lg font-bold leading-tight"><span className={cn("h-[10px] w-[10px] shrink-0 rounded-full", DOT[urgency(top, now)])} /><span className="min-w-0 break-words">{top.title}</span></p>
          <p className="text-sm text-white/80">{[RULES[top.rule].chip(1).replace(/^1 /, ""), top.detail, amountLabel(top, r)].filter(Boolean).join(" · ")}</p>
          <Link to={buttonTarget(top)} data-testid="home-next-step-go" className="fl-btn-primary mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-[#C2410C] text-base font-semibold text-white hover:bg-[#9A3412]">{RULES[top.rule].action}</Link>
        </>) : <p className="mt-1 text-base font-semibold text-white">All clear. Nothing waiting.</p>}
      </section>

      {t.out > 0.005 && (
        <button type="button" data-testid="home-owing-strip" onClick={() => navigate("/admin/invoices?state=unpaid")}
          className="block w-full rounded-2xl border-2 border-[#F97316] bg-[#FFF7ED]/85 p-4 text-left text-[#F97316] shadow-sm backdrop-blur-sm dark:bg-[#F97316]/10">
          <span className="block text-[13px] font-semibold uppercase tracking-wide">Invoices waiting · {t.n}</span>
          <span className="block text-xl font-bold leading-tight sm:text-2xl">{r(t.out)} outstanding{t.late > 0 ? ` · ${r(t.late)} overdue` : ""}</span>
          <span className="block text-sm font-semibold">{t.lateN ? `${t.lateN} late` : "None late"}{t.wait > 0 ? ` · ${r(t.wait)} due on completion` : ""} · open →</span>
        </button>
      )}

      {requests}

      {rest.length > 0 && (
        <section className="rounded-2xl border border-white/20 bg-gradient-to-br from-[#1478C8]/95 to-[#3D9BEB]/90 p-3 text-white shadow-md backdrop-blur-sm" data-testid="home-then">
          <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-[#E8F6FE]">Then, in order · {rest.length}</h3>
          <ol className="divide-y divide-white/20">
            {rest.slice(0, 8).map((s, i) => (
              <li key={s.rule + s.entity_id}>
                <Link to={cardTarget(s)} className="flex min-h-11 items-center gap-2 py-2 text-sm">
                  <span className="w-5 shrink-0 text-right font-semibold text-white/85">{i + 2}.</span>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[urgency(s, now)])} />
                  <span className="min-w-0 flex-1 truncate"><b>{s.title}</b> · {RULES[s.rule].action}</span>
                  <span className="shrink-0 text-xs text-white/85">{amountLabel(s, r)}</span>
                </Link>
              </li>
            ))}
          </ol>
          {rest.length > 8 && <p className="pt-1 text-center text-xs text-white/85">+{rest.length - 8} more in Next steps</p>}
        </section>
      )}
    </div>
  );
}

export default function HomeFocus({ requests }: { requests?: React.ReactNode }) {
  const { isSalesRep } = useSalesRep();
  const { rows, loading } = useNextSteps(isSalesRep ? null : null);
  const { rows: due } = useInvoiceDue();
  const now = useNow();
  if (loading) return null;
  return <HomeFocusView steps={rows} due={due} now={now} requests={requests} />;
}
