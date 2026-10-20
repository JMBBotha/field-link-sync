import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import LeadCloseActions, { V8_OUTLINE, V8_PRIMARY } from "@/components/leads/LeadCloseActions";

const sb = supabase as any;
const OPEN = ["quoted", "followed_up", "viable", "close_due"];
const STEPS = ["Quoted", "Followed up", "Viable / Closed"];
const stepOf = (s: string) => (s === "quoted" ? 0 : s === "followed_up" ? 1 : 2);
const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "—");

/** Quote follow-up calls (Johan 20 Oct 11:49). Online: 1 call → Still viable (date) or Close. Site visit: 2 friendly calls → close prompt. */
export default function QuoteFollowUpPanel({ lead }: { lead: any }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["lead-quote-followups", lead?.id], enabled: !!lead?.id,
    queryFn: async () => (await sb.from("quotes").select("id, quote_number, total, followup_kind, followup_state, followup_count, followup_next_at")
      .eq("lead_id", lead.id).in("followup_state", OPEN).order("sent_at", { ascending: false })).data || [],
  });
  if (!q.data?.length || lead?.closed_at || lead?.dismissed_at) return null;

  const log = async (id: string, result: "viable" | "done", next?: string) => {
    setBusy(id);
    const { error, data } = await sb.rpc("log_quote_followup", { p_quote: id, p_result: result, p_next: next ? new Date(`${next}T09:00:00`).toISOString() : null, p_note: null });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(data === "close_due" ? "Two follow-ups done. Time to close or lock it in." : result === "viable" ? "Next call booked" : "Follow-up logged");
    qc.invalidateQueries({ queryKey: ["lead-quote-followups"] }); qc.invalidateQueries({ queryKey: ["sales-heartbeat"] });
  };

  return (
    <section className="rounded-[14px] border border-[#D6E4EF] bg-white p-4 sm:p-5" data-testid="lead-c-followup">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.06em] text-[#6B7C8F]">Quote follow-up</h2>
      <div className="space-y-4">
        {q.data.map((x: any) => {
          const st = x.followup_state as string;
          const remote = x.followup_kind === "remote";
          const due = st === "close_due" || (x.followup_next_at && Date.parse(x.followup_next_at) <= Date.now());
          return (
            <div key={x.id} className="space-y-2">
              <p className="text-sm font-semibold text-[#0F2A44]">{x.quote_number || "Quote"} · {remote ? "Online quote" : "Site-visit quote"}</p>
              <div className="flex gap-1.5">{STEPS.map((s, i) => <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= stepOf(st) ? "bg-[#1590D6]" : "bg-[#D6E4EF]")} />)}</div>
              <p className="text-xs text-[#6B7C8F]">{STEPS.join(" → ")}</p>
              <p className={cn("text-sm", due ? "font-semibold text-[#0F2A44]" : "text-[#4A5D70]")}>
                {st === "close_due" ? "Two friendly follow-ups done and not locked in. Close it (it can be reopened later)."
                  : st === "viable" ? `Last call on ${fmt(x.followup_next_at)}. After this call, close it.`
                  : remote ? `Follow-up call ${due ? "due now" : `on ${fmt(x.followup_next_at)}`}.`
                  : `Friendly follow-up ${x.followup_count + 1} of 2 ${due ? "due now" : `on ${fmt(x.followup_next_at)}`}.`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {remote && st === "quoted" && (
                  <>
                    <Input type="date" className="h-9 w-40 border-[#D6E4EF]" value={date[x.id] ?? ""} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => setDate({ ...date, [x.id]: e.target.value })} />
                    <Button size="sm" className={V8_PRIMARY} disabled={!date[x.id] || busy === x.id} onClick={() => log(x.id, "viable", date[x.id])} data-testid="followup-viable">Still viable – call again</Button>
                  </>
                )}
                {!remote && st !== "close_due" && (
                  <Button size="sm" className={V8_PRIMARY} disabled={busy === x.id} onClick={() => log(x.id, "done")} data-testid="followup-done">Friendly follow-up done</Button>
                )}
                <LeadCloseActions lead={lead} compact closeOnly closeLabel="Close" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
