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
    <div className="sticky top-0 z-50 border-b border-[#2F86D1] bg-[#3D9BEB] px-2 py-2 text-white print:hidden" data-testid="staff-preview-bar">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
        <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[14px] font-bold text-white hover:bg-white/15" data-testid="staff-preview-back"><ArrowLeft className="h-4 w-4" />Back</button>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/90">Staff preview{d?.quote_number ? ` · ${d.quote_number}` : ""} · client sees no bar</span>
        {d && <>
          <button type="button" onClick={() => setSendOpen(true)} className="fl-btn-primary px-4" data-testid="staff-preview-send">{draft ? "Send" : "Resend"}</button>
          <button type="button" onClick={() => navigate(`/admin/estimates/${d.id}`)} className="fl-btn-secondary px-3" data-testid="staff-preview-edit">Edit</button>
          {draft && <MarkSentManuallyButton kind="quote" id={d.id} status={d.status} size="default" className="min-h-11" onDone={() => qc.invalidateQueries({ queryKey: ["staff-preview-quote", token] })} />}
          <button type="button" onClick={() => setSheet(true)} className="fl-btn-secondary px-3" data-testid="staff-preview-snooze">Snooze / Group</button>
        </>}
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
