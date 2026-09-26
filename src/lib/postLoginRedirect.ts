import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";

export const POST_LOGIN_TIMEOUT_MS = 8000;

/**
 * Decide where to send a freshly signed-in user. Never hangs: on error or
 * timeout it falls back to /admin (AdminLayout re-checks access, so this
 * grants nothing extra) and returns the error message to surface.
 */
export async function resolvePostLoginPath(
  userId: string,
  timeoutMs = POST_LOGIN_TIMEOUT_MS,
): Promise<{ path: string; error: string | null }> {
  try {
    const { data: profile, error: profileErr } = await withTimeout(
      supabase.from("profiles").select("onboarding_completed").eq("id", userId).maybeSingle(),
      timeoutMs,
      "Loading your profile is taking too long.",
    );
    if (profileErr) throw profileErr;
    if (!profile?.onboarding_completed) return { path: "/onboarding", error: null };

    const { data: roles, error: rolesErr } = await withTimeout(
      supabase.from("user_roles").select("role").eq("user_id", userId),
      timeoutMs,
      "Loading your access is taking too long.",
    );
    if (rolesErr) throw rolesErr;
    const hasAdmin = roles?.some((r: { role: string }) => ["admin", "dispatcher", "viewer"].includes(r.role));
    return { path: hasAdmin ? "/admin" : "/field", error: null };
  } catch (e: any) {
    return { path: "/admin", error: e?.message || "Could not load your account." };
  }
}
