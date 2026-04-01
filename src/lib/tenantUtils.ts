import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the current user's company_id from their profile.
 * Call this before inserts to scope records to the user's tenant.
 */
export async function getUserCompanyId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", session.user.id)
    .single();
  return data?.company_id ?? null;
}
