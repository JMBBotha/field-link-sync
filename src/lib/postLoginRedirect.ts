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
  const attempt = async () => {
    const [profileRes, rolesRes] = await withTimeout(
      Promise.all([
        supabase.from("profiles").select("onboarding_completed").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]),
      timeoutMs,
      "Loading your account is taking too long.",
    );
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;
    return { profile: profileRes.data, roles: rolesRes.data };
  };
  try {
    // One retry: a cold first request after sign-in can be slow or fail once.
    const { profile, roles } = await attempt().catch(() => attempt());
    if (!profile?.onboarding_completed) return { path: "/onboarding", error: null };
    const hasAdmin = roles?.some((r: { role: string }) => ["admin", "dispatcher", "viewer"].includes(r.role));
    return { path: hasAdmin ? "/admin" : "/field", error: null };
  } catch (e: any) {
    return { path: "/admin", error: e?.message || "Could not load your account." };
  }
}
