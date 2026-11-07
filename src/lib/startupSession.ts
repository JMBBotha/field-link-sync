import type { Session } from "@supabase/supabase-js";
import { withTimeout } from "@/lib/withTimeout";

/** Same budget as post-login profile lookup. A saved session is local and returns immediately; a stalled iOS refresh must not hold the spinner. */
export const SESSION_RESTORE_TIMEOUT_MS = 8000;
export const SESSION_RESTORE_TIMEOUT_MESSAGE = "Restoring your sign-in is taking too long.";

export type SessionRestoreResult = {
  session: Session | null;
  /** Set when restore timed out or threw. Caller stays unsigned on this device and must not sign out other devices. */
  error: string | null;
};

/**
 * Read the stored session for startup. Never hangs and never calls signOut:
 * a timeout or rejection leaves this device unsigned so welcome/login can render.
 */
export async function restoreStartupSession(
  getSession: () => PromiseLike<{ data?: { session?: Session | null } | null }>,
  timeoutMs = SESSION_RESTORE_TIMEOUT_MS,
): Promise<SessionRestoreResult> {
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => getSession()),
      timeoutMs,
      SESSION_RESTORE_TIMEOUT_MESSAGE,
    );
    return { session: result?.data?.session ?? null, error: null };
  } catch (e) {
    const message = e instanceof Error && e.message
      ? e.message
      : "Couldn't restore your sign-in on this device.";
    return { session: null, error: message };
  }
}
