import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import LeadCloseActions, { V8_OUTLINE } from "@/components/leads/LeadCloseActions";

/** "Dismissed" filter: dismissed + closed leads with audit; admins can restore. */
export default function ClosedLeadsDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"dismissed" | "closed" | "followup">("dismissed");
  const { companyId } = useUserCompanyId();
  const q = useQuery({
    queryKey: ["leads", "closed-list", companyId, tab],
    enabled: open && !!companyId,
    queryFn: async () => {
      let qb = (supabase.from("leads") as any)
        .select("id, customer_name, customer_phone, created_at, dismissed_at, dismiss_reason, closed_at, close_outcome, close_reason, close_note, marketing_followup")
        .eq("company_id", companyId).is("deleted_at", null);
      qb = tab === "dismissed" ? qb.not("dismissed_at", "is", null).order("dismissed_at", { ascending: false })
        : tab === "closed" ? qb.not("closed_at", "is", null).order("closed_at", { ascending: false })
        : qb.eq("marketing_followup", true).order("closed_at", { ascending: false });
      const { data, error } = await qb.limit(200);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  return (
    <>
      <Button variant="outline" size="sm" className={`${V8_OUTLINE} ${className ?? ""}`} onClick={() => setOpen(true)} data-testid="leads-dismissed-filter">Dismissed</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#0F2A44]">Dismissed &amp; closed leads</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {([["dismissed", "Dismissed"], ["closed", "Closed"], ["followup", "Follow up later"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant="outline" className={tab === k ? "border-[#1590D6] bg-[#EEF6FC] text-[#0F6FA8] font-semibold hover:bg-[#EEF6FC]" : V8_OUTLINE} onClick={() => setTab(k)}>{l}</Button>
            ))}
          </div>
          <div className="space-y-2">
            {q.isLoading && <p className="text-sm text-[#6B7C8F]">Loading…</p>}
            {q.data?.length === 0 && <p className="text-sm text-[#6B7C8F]">Nothing here.</p>}
            {q.data?.map((l) => (
              <div key={l.id} className="rounded-[14px] border border-[#D6E4EF] bg-white p-3">
                <p className="text-sm font-semibold">{l.customer_name || "Unnamed"} <span className="font-normal text-[#6B7C8F]">{l.customer_phone}</span></p>
                <p className="mb-1.5 text-xs text-[#6B7C8F]">{new Date(l.dismissed_at || l.closed_at || l.created_at).toLocaleString("en-ZA")}</p>
                <LeadCloseActions lead={l} onDone={() => q.refetch()} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
