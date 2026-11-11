/**
 * Admin shell auth check.
 * A same-user token or session refresh must not replace the outlet with the loader.
 * The first check, and a real change of who is signed in, still block until access is known.
 */
export type AuthOutletMode = "blocking" | "background";

export function authOutletPlan(input: {
  authorizedUserId: string | null;
  userId: string | null;
}): { mode: AuthOutletMode } {
  if (!input.userId || input.authorizedUserId !== input.userId) return { mode: "blocking" };
  return { mode: "background" };
}

/** Blocking checks hide the outlet. A background re-check keeps it mounted. */
export function authCheckHidesOutlet(mode: AuthOutletMode): boolean {
  return mode === "blocking";
}
