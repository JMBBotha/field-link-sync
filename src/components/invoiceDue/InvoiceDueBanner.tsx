import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import { queueSound } from "@/lib/sounds/eventSounds";
import { randShort } from "@/lib/invoiceDue";

const HEARD = "fls.invoiceDue.heard14";

/** +7 amber / +14 red banner on admin pages (admins + sales; sales see own invoices). +14 plays one sound once per invoice per device. */
export default function InvoiceDueBanner() {
  const navigate = useNavigate();
  const { summary: s, canSee } = useInvoiceDue();
  const red = s.ownerCalls[0]; const amber = s.urgent[0];
  useEffect(() => {
    if (!red) return;
    let heard: string[] = []; try { heard = JSON.parse(localStorage.getItem(HEARD) || "[]"); } catch { /* ignore */ }
    const fresh = s.ownerCalls.filter((r) => !heard.includes(r.invoice_id));
    if (!fresh.length) return;
    queueSound("new_lead");
    try { localStorage.setItem(HEARD, JSON.stringify([...heard, ...fresh.map((r) => r.invoice_id)].slice(-200))); } catch { /* ignore */ }
  }, [red, s.ownerCalls]);
  if (!canSee || (!red && !amber)) return null;
  const r = red || amber;
  const more = s.ownerCalls.length + s.urgent.length - 1;
  return (
    <div role="status" data-testid="invoice-due-banner" className={`flex flex-wrap items-center gap-3 px-4 py-2 text-[13px] font-semibold lg:px-6 ${red ? "bg-[#C62828] text-white" : "bg-[#FFF4E0] text-[#8A5300]"}`}>
      <span className="min-w-0 flex-1">
        {red ? "Phone the client" : "Invoice overdue"} · {r.customer_name || r.invoice_number} · {randShort(r.amount_due)} · {r.days} days late{more > 0 ? ` · +${more} more` : ""}
      </span>
      <button onClick={() => navigate("/admin/invoices?due=overdue")} className={`rounded-lg px-3 py-1.5 ${red ? "bg-white text-[#C62828]" : "bg-[#B5730A] text-white"}`}>Review</button>
    </div>
  );
}
