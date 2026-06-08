import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the given user's company_id from their profile.
 * Caller must pass the userId (e.g. from useAuth().user.id) — this keeps
 * the util free of direct supabase.auth calls so auth state stays centralized.
 */
export async function getUserCompanyId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .single();
  return data?.company_id ?? null;
}
