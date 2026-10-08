import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AttentionChips from "@/components/jobs/AttentionChips";
import { leadClock } from "@/lib/leadClock";
import { isTestLead } from "@/lib/callSummary";
import { useLeadSla, useNow } from "@/hooks/useLeadSla";
import { useDoubleBookings } from "@/hooks/useDoubleBookings";

type Chip = { key: string; n: number; label: string; tone: "red" | "orange" | "blue"; to: string };

/** Needs-attention strip (counts only, test records hidden). Click a chip to go where it is fixed. */
export default function AttentionStrip({ className }: { className?: string }) {
  const now = useNow();
  const { sla } = useLeadSla();
  const { count: doubleBookings } = useDoubleBookings();
  const { data } = useQuery({
    queryKey: ["attention-strip"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [leads, jobs, paid, accepted] = await Promise.all([
        (supabase.from("leads") as any).select("id, customer_name, status, created_at, primary_intent, assigned_agent_id, first_contact_at, stage2_done_at")
          .eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).limit(500),
        supabase.from("jobs").select("id, title, status, scheduled_for").eq("status", "scheduled").lt("scheduled_for", new Date().toISOString()).limit(500),
        supabase.from("invoices").select("quote_id, customer_name").in("status", ["paid", "partially_paid"]).not("quote_id", "is", null).limit(1000),
        supabase.from("quotes").select("id, customer_name").eq("status", "accepted").limit(500),
      ]);
      const quoteIds = (accepted.data || []).map((q: any) => q.id);
      const booked = quoteIds.length
        ? ((await supabase.from("jobs").select("quote_id, status").in("quote_id", quoteIds)).data || []).filter((j: any) => j.status !== "cancelled").map((j: any) => j.quote_id)
        : [];
      const paidIds = new Set((paid.data || []).map((i: any) => i.quote_id));
      return {
        leads: ((leads.data || []) as any[]).filter((l) => !isTestLead(l.customer_name)),
        lateJobs: ((jobs.data || []) as any[]).filter((j) => !isTestLead(j.title)).length,
        paidNoJob: (accepted.data || []).filter((q: any) => paidIds.has(q.id) && !booked.includes(q.id) && !isTestLead(q.customer_name)).length,
      };
    },
  });
  const leads = data?.leads || [];
  const clocks = leads.map((l) => leadClock(l, now, sla));
  const chips = ([
    { key: "contact", n: clocks.filter((c) => c?.stage === 1 && c.tone === "red").length, label: `leads past ${sla.contactMinutes}-min contact`, tone: "red", to: "/admin/dispatch" },
    { key: "quote", n: clocks.filter((c) => c?.stage === 2 && c.tone === "red").length, label: "quote/visit overdue", tone: "red", to: "/admin/dispatch" },
    { key: "double", n: doubleBookings, label: "double bookings", tone: "red", to: "/admin/dispatch" },
    { key: "late", n: data?.lateJobs || 0, label: "jobs late to start", tone: "red", to: "/admin/jobs?tab=dispatch&view=cards" },
    { key: "paid", n: data?.paidNoJob || 0, label: "deposits paid, no job booked", tone: "red", to: "/admin/jobs?tab=pipeline&view=stages" },
    { key: "unassigned", n: leads.filter((l) => !l.assigned_agent_id).length, label: "unassigned leads", tone: "orange", to: "/admin/dispatch" },
    { key: "queued", n: clocks.filter((c) => c?.stage === 0).length, label: "after-hours leads queued", tone: "blue", to: "/admin/dispatch" },
  ] as Chip[]).filter((c) => c.n > 0);
  return <AttentionChips chips={chips} className={className} data-testid="attention-strip" />;
}
