import { supabase } from "@/integrations/supabase/client";

/**
 * Team invites (Q4/Q4b): the invite applies when the invitee confirms their email via the link; until they set a
 * password, me_needs_password() is true and we send them to /set-password wherever the link landed. Never throws.
 */
export async function redirectIfPasswordMissing(loc: Pick<Location, "pathname" | "replace"> = window.location): Promise<boolean> {
  if (loc.pathname === "/set-password") return false;
  try {
    const rpc = (supabase as unknown as { rpc?: (fn: string) => Promise<{ data: unknown; error: unknown }> }).rpc;
    if (typeof rpc !== "function") return false;
    const { data, error } = await rpc.call(supabase, "me_needs_password");
    if (!error && data === true) {
      loc.replace("/set-password");
      return true;
    }
  } catch {
    /* missing function / offline: never block sign-in */
  }
  return false;
}

/** Map a pending invite row back to the Team page's invite option key. */
export function inviteOptionKey(inv: { role: string; dispatch_role: string | null }): string {
  return inv.role === "dispatcher" && inv.dispatch_role === "sales" ? "sales" : inv.role;
}
