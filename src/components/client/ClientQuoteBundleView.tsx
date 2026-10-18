import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, FileText, MessageSquare } from "lucide-react";

type Q = { quote_number: string | null; summary: string | null; total: number | null; valid_until: string | null; status: string; token: string | null; changes_open: boolean };
type B = { customer_name: string | null; company_name: string | null; logo_url: string | null; phone: string | null; quotes: Q[] };
const fmtR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
const fd = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Public "View all quotes" page. Each quote opens its own /quote/:token page, which owns accept, changes and self-adjust. */
export default function ClientQuoteBundleView() {
  const { token } = useParams<{ token: string }>();
  const [b, setB] = useState<B | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("public_quote_bundle" as never, { p_token: token } as never);
      const v = data as unknown as B | null;
      if (v && v.quotes?.length) { setB(v); setState("ok"); } else setState("missing");
    })();
  }, [token]);

  if (state === "loading") return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#0B4FA8]" /></div>;
  if (state === "missing" || !b) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-muted-foreground">This link is no longer available. Please contact us for your quotes.</div>;

  const open = (q: Q, action?: string) => {
    if (!q.token) return;
    const qs = new URLSearchParams({ bundle: token || "" });
    if (action) qs.set("action", action);
    window.location.href = `/quote/${encodeURIComponent(q.token)}?${qs.toString()}`;
  };
  const first = (b.customer_name || "").trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-[#eef3f9]">
      <header className="bg-[#0B4FA8] bg-gradient-to-r from-[#0B4FA8] to-[#1AA7EC] text-white">
        <div className="max-w-3xl mx-auto px-4 py-5">
          {b.logo_url && <img src={b.logo_url} alt="" className="h-10 w-auto mb-2 bg-white rounded px-2 py-1" />}
          <div className="text-xl font-extrabold break-words">{b.company_name || "Your quotes"}</div>
          <div className="text-sm opacity-90">{b.quotes.length} quotes for {b.customer_name || "you"}</div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <p className="text-sm text-ink">{first ? `Hi ${first}, h` : "H"}ere are your quotes side by side. Open one to see every line, then accept it or ask for changes. Each quote can be accepted on its own.</p>
        {b.quotes.map((q, i) => {
          const done = q.status === "accepted" || q.status === "declined" || q.status === "expired";
          return (
            <div key={i} className="rounded-2xl bg-white shadow-sm border border-[#e3eaf2] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-ink break-all">{q.quote_number || "Quote"}</div>
                  {q.summary && <div className="text-sm text-ink-secondary mt-0.5 break-words">{q.summary}</div>}
                  {q.valid_until && <div className="text-xs text-ink-muted mt-1">Valid until {fd(q.valid_until)}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-extrabold text-[#0B4FA8] whitespace-nowrap">{fmtR(Number(q.total) || 0)}</div>
                  <div className="text-xs text-ink-muted">incl. VAT</div>
                </div>
              </div>
              {q.status === "accepted" && <div className="mt-3 text-sm font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Accepted, thank you</div>}
              {q.changes_open && !done && <div className="mt-3 text-xs text-[#b45f06]">Changes requested. We'll send you an updated quote.</div>}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button onClick={() => open(q)} className="h-11 rounded-xl border border-[#0B4FA8] text-[#0B4FA8] font-semibold text-sm flex items-center justify-center gap-1.5"><FileText className="h-4 w-4" /> View</button>
                {!done && <button onClick={() => open(q, "accept")} className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-1.5"><CheckCircle className="h-4 w-4" /> Accept quote</button>}
                {!done && <button onClick={() => open(q, "changes")} className="h-11 rounded-xl border border-slate-300 text-ink font-semibold text-sm flex items-center justify-center gap-1.5"><MessageSquare className="h-4 w-4" /> Ask for changes</button>}
              </div>
            </div>
          );
        })}
        {b.phone && <p className="text-center text-xs text-ink-secondary">Questions? Call us on <a className="underline" href={`tel:${b.phone}`}>{b.phone}</a>.</p>}
      </main>
    </div>
  );
}
