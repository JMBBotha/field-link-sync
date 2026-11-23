import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { newUncontactedLeads, type NewLeadRow } from "@/lib/newUncontactedLead";

/**
 * The locked "uncommitted lead inbox" rule (see project knowledge).
 *
 * A lead is in the inbox when ALL of:
 *  - deleted_at is null
 *  - lead_status NOT in (completed, lost, cancelled, resolved_before_visit)
 *  - status NOT in (completed, converted, cancelled, resolved_before_visit)
 *  - assigned_agent_id is null OR scheduled_date is null
 *
 * The badge only clears once the lead is BOTH assigned AND scheduled.
 */
export const CLOSED_LEAD_STATUS = ["completed", "lost", "cancelled", "resolved_before_visit"];
export const CLOSED_STATUS = ["completed", "converted", "cancelled", "resolved_before_visit"];

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
  "id, customer_name, customer_phone, customer_address, service_type, status, lead_status, priority, primary_intent, assigned_agent_id, scheduled_date, scheduled_time, deleted_at, dismissed_at, closed_at, merged_into_id, created_at, source, notes, first_contact_at, contact_attempts, stage2_done_at, sla_breached_at, quote_sla_breached_at, call_summary, call_area, call_urgency, call_next_action";

async function loadInboxRows(companyId: string) {
  const run = (columns: string) => supabase
    .from("leads")
    .select(columns)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  // archived_at arrives with the lead-archive migration. Until that is applied, read the same rows without it.
  const withArchive = await run(`${INBOX_COLUMNS}, archived_at`);
  if (!withArchive.error) return (withArchive.data as any[]) || [];
  const err = withArchive.error as { message?: string; details?: string };
  const missing = /archived_at/i.test(`${err.message || ""} ${err.details || ""}`);
  if (!missing) throw withArchive.error;
  const plain = await run(INBOX_COLUMNS);
  if (plain.error) throw plain.error;
  return (plain.data as any[]) || [];
}

/** Shared inbox list + count, company-scoped, realtime. */
export function useLeadInbox() {
  const qc = useQueryClient();
  const { companyId, loading: companyLoading } = useUserCompanyId();

  const query = useQuery({
    queryKey: ["lead-inbox", companyId],
    enabled: !!companyId,
    queryFn: async () => ((await loadInboxRows(companyId as string)) || []).filter(isInboxLead),
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`lead-inbox-rt-${Math.random().toString(36).slice(2, 10)}`) // unique per instance (sidebar + dashboard both mount this hook)
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
    isLoading: query.data === undefined && (companyLoading || query.isLoading),
  };
}

/**
 * The red "N new leads" button and Jobs → Today "Needs you" share this list.
 * Same company rows as the inbox query, then the new / not-contacted rule.
 */
export function useNewUncontactedLeads() {
  const inbox = useLeadInbox();
  const leads = newUncontactedLeads((inbox.leads || []) as NewLeadRow[]);
  return { leads, count: leads.length, isLoading: inbox.isLoading };
}

/** Count-only convenience wrapper. */
export function useLeadInboxCount() {
  return useLeadInbox().count;
}
