import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";
import { MarkSentManuallyButton } from "@/components/documents/MarkSentManually";
import { SnoozeDialog } from "@/components/sales/NextStepsPanel";
import type { NextStep } from "@/lib/nextSteps";

/** Staff-only bar on the client view (?preview=1) (Johan 1 Nov 21:28).
 *  Renders only when the signed-in staff login can read the quote under RLS; a client never sees it. */
export default function StaffPreviewBar({ token }: { token: string }) {
  const navigate = useNavigate(); const qc = useQueryClient();
  const [sendOpen, setSendOpen] = useState(false); const [sheet, setSheet] = useState(false);
  const q = useQuery({
    queryKey: ["staff-preview-quote", token],
    queryFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return null;
      const { data } = await (supabase.from("quotes") as any).select("id, quote_number, status, customer_id, customer_name").eq("public_token", token).maybeSingle();
      return data ?? null;
    },
  });
  const d: any = q.data;
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/admin/quotes"));
  const draft = !d || ["draft", "pending"].includes(d.status || "draft");
  return (
    // iPhone: clear the notch/status bar (viewport-fit=cover + the V8 body::before inset strip would hide the top
    // of the bar), Back first, then 44px actions that wrap below Back so all fit at 375-390px (Johan 2 Nov 14:36).
    <div className="sticky top-0 z-50 border-b border-[#2F86D1] bg-[#3D9BEB] px-2 pb-2 text-white print:hidden" data-testid="staff-preview-bar"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
      <div className="mx-auto flex max-w-4xl flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex min-w-0 items-center gap-2 sm:flex-1">
          <button type="button" onClick={back} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[14px] font-bold text-white hover:bg-white/15" data-testid="staff-preview-back"><ArrowLeft className="h-4 w-4" />Back</button>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/90">Staff preview{d?.quote_number ? ` · ${d.quote_number}` : ""} · client sees no bar</span>
        </div>
        {d && <div className="flex flex-wrap items-center gap-2" data-testid="staff-preview-actions">
          <button type="button" onClick={() => setSendOpen(true)} className="fl-btn-primary shrink-0 whitespace-nowrap px-4" data-testid="staff-preview-send">{draft ? "Send" : "Resend"}</button>
          <button type="button" onClick={() => navigate(`/admin/estimates/${d.id}`)} className="fl-btn-secondary shrink-0 whitespace-nowrap px-3" data-testid="staff-preview-edit">Edit</button>
          {draft && <MarkSentManuallyButton kind="quote" id={d.id} status={d.status} size="default" className="min-h-11 shrink-0 whitespace-nowrap" onDone={() => qc.invalidateQueries({ queryKey: ["staff-preview-quote", token] })} />}
          <button type="button" onClick={() => setSheet(true)} className="fl-btn-secondary shrink-0 whitespace-nowrap px-3" data-testid="staff-preview-snooze">Snooze / Group</button>
        </div>}
      </div>
      {d && <SendQuoteDialog open={sendOpen} onOpenChange={setSendOpen} quoteId={d.id} quoteNumber={d.quote_number || "Draft"} customerId={d.customer_id ?? null} customerName={d.customer_name || "Customer"} />}
      {d && sheet && <SnoozeDialog
        row={{ rule: "followup", entity_type: "quote", entity_id: d.id, title: d.customer_name || "Quote", detail: d.quote_number || "" } as unknown as NextStep}
        onClose={() => setSheet(false)}
        onSave={async (o) => {
          const { error } = await (supabase.rpc as any)("snooze_next_step", { p_rule: "followup", p_entity_type: "quote", p_entity_id: d.id, p_until: o.until?.toISOString() ?? null, p_dismiss: !!o.dismiss, p_reason: o.reason });
          if (error) throw error; qc.invalidateQueries({ queryKey: ["sales-next-steps"] }); setSheet(false);
        }}
        onGroup={async (other) => {
          const { error } = await (supabase.rpc as any)("group_quote_option", { p_quote: d.id, p_other: other });
          if (error) throw error; qc.invalidateQueries({ queryKey: ["sales-next-steps"] });
        }} />}
    </div>
  );
}
