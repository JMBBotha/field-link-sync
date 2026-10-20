import { useNavigate } from "react-router-dom";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import { randShort } from "@/lib/invoiceDue";

/** Heartbeat "Money due" tile: final invoices outstanding, split due ≤7 days / today / overdue, one Next step button. */
export default function MoneyDueTile() {
  const navigate = useNavigate();
  const { summary: s, canSee, loading } = useInvoiceDue();
  if (!canSee || loading || s.count === 0) return null;
  const parts = [s.soon.amount, s.today.amount, s.overdue.amount];
  const sum = parts.reduce((a, b) => a + b, 0) || 1;
  const next = s.ownerCalls.length ? { label: `Phone ${s.ownerCalls[0].customer_name || "client"} (${s.ownerCalls[0].days} days late)`, to: "/admin/invoices?due=overdue" }
    : s.toApprove ? { label: `Review ${s.toApprove} reminder${s.toApprove === 1 ? "" : "s"}`, to: "/admin/invoices?due=all" }
    : s.overdue.count ? { label: "See overdue invoices", to: "/admin/invoices?due=overdue" } : null;
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5" data-testid="money-due-tile">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Money due · final invoices</div>
      <div className="mt-1 text-[26px] font-bold text-[#123]">{randShort(s.total)} <span className="text-[13px] font-medium text-muted-foreground">outstanding · {s.count} invoice{s.count === 1 ? "" : "s"}</span></div>
      <div className="my-2 flex h-2.5 overflow-hidden rounded-full bg-[#EEF3F8]">
        <div style={{ flex: parts[0] / sum }} className="bg-[#1AA7EC]" /><div style={{ flex: parts[1] / sum }} className="bg-[#F5A524]" /><div style={{ flex: parts[2] / sum }} className="bg-[#E5484D]" />
      </div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <button onClick={() => navigate("/admin/invoices?due=soon")} className="rounded-full bg-[#E8F6FE] px-3 py-1 text-[#1590D6]">Due in 7 days · {randShort(s.soon.amount)} ({s.soon.count})</button>
        <button onClick={() => navigate("/admin/invoices?due=today")} className="rounded-full bg-[#FFF4E0] px-3 py-1 text-[#B5730A]">Due today · {randShort(s.today.amount)} ({s.today.count})</button>
        <button onClick={() => navigate("/admin/invoices?due=overdue")} className="rounded-full bg-[#FDECEC] px-3 py-1 text-[#C9373C]">Overdue · {randShort(s.overdue.amount)} ({s.overdue.count})</button>
      </div>
      {next && <button onClick={() => navigate(next.to)} className="mt-3 rounded-xl bg-[#1AA7EC] px-4 py-2 text-[14px] font-semibold text-white">Next step now: {next.label}</button>}
    </section>
  );
}
