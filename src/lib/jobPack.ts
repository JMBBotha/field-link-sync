/** Tech job pack loaders with a phone copy: the last good answer is used when there is no signal. No money fields. */
import { supabase } from "@/integrations/supabase/client";
import type { PackingRow } from "@/lib/packingList";

export async function withOfflineCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `fls.pack.${key}`;
  try {
    const v = await fn();
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* storage full */ }
    return v;
  } catch (e) {
    try { const raw = localStorage.getItem(k); if (raw) return JSON.parse(raw).v as T; } catch { /* ignore */ }
    throw e;
  }
}

export const JOB_SHEET_SELECT = "id, lead_id, title, description, address, scheduled_for, status, job_type, site_check_status, customers(name, phone, address), leads(customer_address)";

export const loadJobSheet = (id: string) => withOfflineCache(`job.${id}`, async () => {
  const { data, error } = await supabase.from("jobs").select(JOB_SHEET_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as any;
});

export const loadPackingList = (id: string) => withOfflineCache(`packing.${id}`, async () => {
  const { data, error } = await (supabase.rpc as any)("get_job_packing_list", { p_job_id: id });
  if (error) throw error;
  return (data || []) as PackingRow[];
});

/** Today screen: keep each of today's packs on the phone. */
export async function primeJobPack(id: string) {
  await Promise.allSettled([loadJobSheet(id), loadPackingList(id)]);
}
