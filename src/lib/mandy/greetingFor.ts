/**
 * Build Mandy's session greeting, personalised with the staff user's first
 * name. Resolution order: profiles.first_name → first word of
 * profiles.full_name → auth user_metadata (first_name / full_name / name).
 * Trimmed, first letter capitalised only; falls back to the generic greeting.
 */
export const GENERIC_GREETING = "Hi, what can I do for you?";

export interface GreetingProfile {
  first_name?: string | null;
  full_name?: string | null;
}

export interface GreetingUserMeta {
  first_name?: unknown;
  full_name?: unknown;
  name?: unknown;
}

function firstWord(v: unknown): string {
  if (typeof v !== "string") return "";
  const w = v.trim().split(/\s+/)[0] ?? "";
  return w;
}

function capFirst(w: string): string {
  if (!w) return "";
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function greetingFor(
  profile: GreetingProfile | null | undefined,
  userMeta?: GreetingUserMeta | null,
): string {
  const raw =
    firstWord(profile?.first_name) ||
    firstWord(profile?.full_name) ||
    firstWord(userMeta?.first_name) ||
    firstWord(userMeta?.full_name) ||
    firstWord(userMeta?.name);
  const name = capFirst(raw);
  return name ? `Hi ${name}, what can I do for you?` : GENERIC_GREETING;
}
