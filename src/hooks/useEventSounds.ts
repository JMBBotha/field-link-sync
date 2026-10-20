import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";
import { isTestLead } from "@/lib/callSummary";
import { getSoundPrefs, installAutoplayUnlock, queueSound, subscribeSoundPrefs } from "@/lib/sounds/eventSounds";

const FRESH_MS = 10 * 60_000;
const fresh = (ts?: string | null) => !ts || Date.now() - new Date(ts).getTime() < FRESH_MS;

/** Plays event sounds from realtime lead/quote/invoice changes (RLS scopes them to the user's company). Admins + sales reps only; never techs. Mount once. */
export function useEventSounds() {
  const { canSee, isSalesRep, userId } = useHeartbeatAudience();
  useEffect(() => {
    if (!canSee) return;
    installAutoplayUnlock();
    const seen = new Set<string>();
    const once = (k: string) => { if (seen.has(k)) return false; seen.add(k); return true; };
    const ch = supabase.channel("event-sounds")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, (p) => {
        const l: any = p.new; if (!l || l.deleted_at || l.merged_into_id || isTestLead(l.customer_name || "")) return;
        if (isSalesRep && l.assigned_agent_id && l.assigned_agent_id !== userId) return;
        if (once(`lead:${l.id}`)) queueSound("new_lead");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quotes" }, (p) => {
        const q: any = p.new; if (!q || q.status !== "accepted" || !fresh(q.accepted_at) || isTestLead(q.customer_name || "")) return;
        if (isSalesRep && q.sales_engineer_id && q.sales_engineer_id !== userId) return;
        if (once(`quote:${q.id}`)) queueSound("deal_closed");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (p) => {
        const i: any = p.new; if (!i || i.status !== "paid" || (p.old as any)?.status === "paid") return;
        if (i.paid_date && Date.now() - new Date(i.paid_date).getTime() > 2 * 86400_000) return;
        const deposit = String(i.notes || "").startsWith("DEPOSIT") || i.invoice_type === "deposit";
        if (once(`inv:${i.id}`)) queueSound(deposit ? "deposit_paid" : "final_payment");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [canSee, isSalesRep, userId]);
}

export function useSoundPrefs() {
  const [p, setP] = useState(getSoundPrefs);
  useEffect(() => subscribeSoundPrefs(setP), []);
  return p;
}
