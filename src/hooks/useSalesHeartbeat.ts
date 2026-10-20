import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useLeadSla } from "@/hooks/useLeadSla";
import { isTestLead } from "@/lib/callSummary";
import { buildHeartbeat, toLimits, type HbLead, type HbQuote, type HbInvoice, type HbJob } from "@/lib/salesHeartbeat";

/** Who sees the sales heartbeat: admins and sales reps. Techs (field_agent only) and non-sales dispatchers never get the hot-lead banner. */
export function useHeartbeatAudience() {
  const { roles, userId, loading } = useRole();
  const { isSalesRep, loading: l2 } = useSalesRep();
  const isAdmin = (roles as string[]).includes("admin");
  return { userId, isAdmin, isSalesRep, canSee: !loading && !l2 && (isAdmin || isSalesRep), loading: loading || l2 };
}

export function useSalesHeartbeat(enabled = true) {
  const { userId, isSalesRep, canSee } = useHeartbeatAudience();
  const { settings } = useCompanySettings();
  const { sla } = useLeadSla();
  const qc = useQueryClient();
  const on = enabled && canSee;
  const q = useQuery({
    queryKey: ["sales-heartbeat", isSalesRep ? userId : "all"],
    enabled: on, refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 86400_000).toISOString();
      const db = supabase as any;
      const [leads, quotes, invoices, jobs, esc] = await Promise.all([
        db.from("leads").select("id, customer_name, created_at, first_contact_at, acknowledged_at, visit_booked_at, last_contact_attempt_at, primary_intent, assigned_agent_id, status, call_summary, customer_phone, phone")
          .is("deleted_at", null).is("merged_into_id", null).gte("created_at", since).order("created_at", { ascending: false }).limit(800),
        db.from("quotes").select("id, status, total, created_at, sent_at, viewed_at, accepted_at, lead_id, sales_engineer_id, customer_name, quote_number")
          .gte("updated_at", since).neq("status", "superseded").limit(1000),
        db.from("invoices").select("quote_id, status, notes, grand_total, paid_date").not("quote_id", "is", null).gte("created_at", since).limit(2000),
        db.from("jobs").select("id, quote_id, status, created_at, scheduled_for, completed_at, title").not("quote_id", "is", null).gte("created_at", since).limit(2000),
        db.from("sales_escalations").select("entity_id, stage, level, created_at, message, notified_user_ids").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      ]);
      if (leads.error) throw leads.error;
      return { leads: (leads.data || []) as HbLead[], quotes: (quotes.data || []) as HbQuote[], invoices: (invoices.data || []) as HbInvoice[], jobs: (jobs.data || []) as HbJob[], esc: (esc.data || []) as any[] };
    },
  });
  // Live: new / changed leads refresh at once (realtime), everything else every minute.
  useEffect(() => {
    if (!on) return;
    const ch = supabase.channel("hb-leads").on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => qc.invalidateQueries({ queryKey: ["sales-heartbeat"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, qc]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const minute = Math.floor(now / 60_000);
  const hb = useMemo(() => {
    if (!q.data) return null;
    const d = q.data; const mine = (id?: string | null) => !isSalesRep || !id || id === userId;
    const leads = d.leads.filter((l) => !isTestLead(l.customer_name || "") && mine(l.assigned_agent_id));
    const quotes = d.quotes.filter((x) => !isTestLead(x.customer_name || "") && (!isSalesRep || x.sales_engineer_id === userId));
    const qIds = new Set(quotes.map((x) => x.id));
    return buildHeartbeat({
      leads, quotes, invoices: d.invoices.filter((i) => i.quote_id && qIds.has(i.quote_id)), jobs: d.jobs.filter((j) => j.quote_id && qIds.has(j.quote_id)),
      limits: toLimits((settings as any)?.sales_stage_limits), contactMinutes: sla?.contactMinutes, escalatedIds: new Set(d.esc.map((e) => e.entity_id)), now: minute * 60_000,
    });
  }, [q.data, isSalesRep, userId, settings, sla?.contactMinutes, minute]);
  return { hb, now, esc: q.data?.esc || [], loading: q.isLoading, canSee, refetch: q.refetch };
}
