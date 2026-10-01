import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SLA, type SlaSettings } from "@/lib/leadClock";

export const toSla = (r: any): SlaSettings => r ? {
  enabled: r.enabled !== false,
  contactMinutes: Number(r.contact_minutes) || DEFAULT_SLA.contactMinutes,
  workDays: Array.isArray(r.work_days) && r.work_days.length ? r.work_days.map(Number) : DEFAULT_SLA.workDays,
  open: String(r.open_time || DEFAULT_SLA.open).slice(0, 5),
  close: String(r.close_time || DEFAULT_SLA.close).slice(0, 5),
  amber: String(r.quote_amber_time || DEFAULT_SLA.amber).slice(0, 5),
} : DEFAULT_SLA;

/** Company lead-SLA settings (public.lead_sla_settings, RLS = own company); defaults if none. */
export function useLeadSla() {
  const { data } = useQuery({
    queryKey: ["lead-sla-settings"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await (supabase.from("lead_sla_settings" as any) as any).select("*").limit(1).maybeSingle();
      return (data as any) ?? null;
    },
  });
  return { row: data ?? null, sla: toSla(data) };
}

const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
/** One shared 1-second ticker for every live lead clock on screen. */
export function useNow(): number {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    if (!timer) timer = setInterval(() => subs.forEach((s) => s()), 1000);
    return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = undefined; } };
  }, []);
  return Date.now();
}

/** Log a contact: 'reached'/'sent' stops stage 1; 'no_answer' only counts an attempt. */
export async function logLeadContact(leadId: string, channel: "call" | "whatsapp", outcome: "reached" | "no_answer" | "sent") {
  const { error } = await (supabase.rpc as any)("log_lead_contact", { p_lead_id: leadId, p_channel: channel, p_outcome: outcome });
  if (error) throw error;
}
