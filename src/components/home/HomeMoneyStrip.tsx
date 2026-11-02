import { useNavigate } from "react-router-dom";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";

const r = (n: number) => "R " + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ");

/** Outstanding / overdue money in bold orange at the top of the home page (Johan 2 Nov 17:49).
 *  Balances still due on completion are counted separately and never as overdue. */
export default function HomeMoneyStrip() {
  const navigate = useNavigate();
  const { rows, canSee } = useInvoiceDue();
  if (!canSee || !rows.length) return null;
  let out = 0, late = 0, lateN = 0, wait = 0;
  for (const x of rows) {
    const a = Number(x.amount_due) || 0; out += a;
    if (x.waiting) wait += a; else if ((x.days ?? 0) > 0) { late += a; lateN++; }
  }
  if (out <= 0.005) return null;
  return (
    <button type="button" data-testid="home-owing-strip" onClick={() => navigate("/admin/invoices?state=unpaid")}
      className="block w-full rounded-2xl border-2 border-[#F97316] bg-[#FFF7ED] p-3 text-left text-[#F97316] shadow-sm dark:bg-[#F97316]/10">
      <span className="block text-lg font-bold leading-tight sm:text-xl">
        {r(out)} outstanding{late > 0 ? ` · ${r(late)} overdue` : ""}
      </span>
      <span className="block text-sm font-semibold">
        {rows.length} invoice{rows.length === 1 ? "" : "s"}{lateN ? ` · ${lateN} late` : ""}{wait > 0 ? ` · ${r(wait)} due on completion` : ""} · open →
      </span>
    </button>
  );
}
