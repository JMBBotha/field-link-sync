import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the overdue maintenance count.
 *
 * The RPC is SECURITY DEFINER and only executable by the `authenticated` role,
 * so calling it before the session is hydrated (or after it expired) hits the
 * DB as `anon` and fails with "permission denied for function".
 * We wait for a real session and throw on error so React Query can retry
 * instead of silently rendering a wrong count of 0.
 */
export async function fetchOverdueMaintenanceCount(): Promise<number> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("No active session for overdue maintenance count");
  }

  const { data, error } = await supabase.rpc("get_overdue_maintenance_count");
  if (error) throw error;
  return Number(data ?? 0);
}
