import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";

/**
 * The locked "uncommitted lead inbox" rule (see project knowledge).
 *
 * A lead is in the inbox when ALL of:
 *  - deleted_at is null
 *  - lead_status NOT in (completed, lost, cancelled)
 *  - status NOT in (completed, converted, cancelled)
 *  - assigned_agent_id is null OR scheduled_date is null
 *
 * The badge only clears once the lead is BOTH assigned AND scheduled.
 */
export const CLOSED_LEAD_STATUS = ["completed", "lost", "cancelled"];
export const CLOSED_STATUS = ["completed", "converted", "cancelled"];

export interface InboxLeadLike {
  deleted_at?: string | null;
  lead_status?: string | null;
  status?: string | null;
  assigned_agent_id?: string | null;
  scheduled_date?: string | null;
}

export function isInboxLead(lead: InboxLeadLike | null | undefined): boolean {
  if (!lead) return false;
  if (lead.deleted_at) return false;
  if (lead.lead_status && CLOSED_LEAD_STATUS.includes(lead.lead_status)) return false;
  if (lead.status && CLOSED_STATUS.includes(lead.status)) return false;
  return !lead.assigned_agent_id || !lead.scheduled_date;
}

export const INBOX_ROUTE = "/admin/dispatch?inbox=1";

const INBOX_COLUMNS =
  "id, customer_name, customer_phone, customer_address, service_type, status, lead_status, priority, primary_intent, assigned_agent_id, scheduled_date, scheduled_time, deleted_at, created_at";

/** Shared inbox list + count, company-scoped, realtime. */
export function useLeadInbox() {
  const qc = useQueryClient();
  const { companyId, loading: companyLoading } = useUserCompanyId();

  const query = useQuery({
    queryKey: ["lead-inbox", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select(INBOX_COLUMNS)
        .eq("company_id", companyId as string)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data as any[]) || []).filter(isInboxLead);
    },
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("lead-inbox-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["lead-inbox"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, qc]);

  const leads = query.data || [];
  return {
    leads,
    count: leads.length,
    isLoading: companyLoading || query.isLoading,
  };
}

/** Count-only convenience wrapper. */
export function useLeadInboxCount() {
  return useLeadInbox().count;
}
