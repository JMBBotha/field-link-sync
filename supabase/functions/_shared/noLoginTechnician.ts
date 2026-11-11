/**
 * No-login technicians (preview).
 *
 * A dedicated staff table would fork identity: visits, assignments, and earnings
 * already point at profiles.id, which is an auth.users id. Creating a real auth
 * user with no password, a banned session, and a non-deliverable email keeps
 * that one id. "Send login invite" later changes the email on the same user.
 *
 * app_metadata.provision is set only by the service role (admin.createUser).
 * A public sign-up cannot set it, so handle_new_user will not grant a company
 * from client metadata.
 */

export const NO_LOGIN_EMAIL_DOMAIN = "no-login.fieldlynk.invalid";

/** Device alerts the office watchdog raises when it expects a phone. */
export const DEVICE_ALERT_RULES = [
  "no_en_route",
  "not_started",
  "not_accepted",
  "not_accepted_urgent",
  "not_finished",
] as const;

/** Harness fixture only. These rows are not created in the live database. */
export const HARNESS_NO_LOGIN_TECHS = [
  { id: "fixture-abie-croy", name: "Abie Croy" },
  { id: "fixture-george-king", name: "George King" },
] as const;

export function noLoginEmail(stamp: string): string {
  return `tech+${stamp}@${NO_LOGIN_EMAIL_DOMAIN}`;
}

export function isNoLoginEmail(email: string | null | undefined): boolean {
  return (email || "").trim().toLowerCase().endsWith(`@${NO_LOGIN_EMAIL_DOMAIN}`);
}

export function normalizePersonName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function nameKey(raw: string | null | undefined): string {
  return normalizePersonName(raw || "").toLocaleLowerCase();
}

export function validateTechnicianName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizePersonName(raw);
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the technician's name (2–80 characters)" };
  if (!/\p{L}/u.test(name)) return { ok: false, error: "Name needs a letter" };
  return { ok: true, name };
}

export function validatePhone(raw: string | null | undefined): { ok: true; phone: string | null } | { ok: false; error: string } {
  const phone = (raw ?? "").trim();
  if (!phone) return { ok: true, phone: null };
  if (phone.length > 30 || !/^[0-9+().\-\s]+$/.test(phone)) {
    return { ok: false, error: "Phone can only contain digits and + ( ) -" };
  }
  return { ok: true, phone };
}

export type AccessInput = {
  userId: string | null;
  roles: string[];
  companyId: string | null;
  requestedCompanyId?: string | null;
  /** The service-role key is not a company admin. */
  serviceRole?: boolean;
};

export function decideAdminCompanyAccess(
  input: AccessInput,
): { ok: true; companyId: string } | { ok: false; status: 401 | 403; error: string } {
  if (input.serviceRole || !input.userId) {
    return input.serviceRole
      ? { ok: false, status: 403, error: "Sign in as a company admin" }
      : { ok: false, status: 401, error: "Not authenticated" };
  }
  if (!input.roles.includes("admin")) {
    return { ok: false, status: 403, error: "Only a company admin can add a technician" };
  }
  if (!input.companyId) {
    return { ok: false, status: 403, error: "Your account has no company" };
  }
  if (input.requestedCompanyId && input.requestedCompanyId !== input.companyId) {
    return { ok: false, status: 403, error: "You can only add technicians to your own company" };
  }
  return { ok: true, companyId: input.companyId };
}

export function duplicateNameBlock(
  name: string,
  existing: { id: string; full_name: string | null; archived_at?: string | null }[],
  confirm: boolean,
): { blocked: false } | { blocked: true; matches: { id: string; full_name: string }[] } {
  const key = nameKey(name);
  const matches = existing.filter((row) => !row.archived_at && !!key && nameKey(row.full_name) === key);
  if (matches.length > 0 && !confirm) {
    return { blocked: true, matches: matches.map((row) => ({ id: row.id, full_name: row.full_name || "" })) };
  }
  return { blocked: false };
}

/** Live lead / install offers. A no-login technician is never a candidate. */
export function takesLiveOffer(profile: {
  no_login?: boolean | null;
  archived_at?: string | null;
  dispatch_active?: boolean | null;
}): boolean {
  if (profile.no_login) return false;
  if (profile.archived_at) return false;
  if (profile.dispatch_active === false) return false;
  return true;
}

/** Push, location pings, and late / en-route alerts assume a signed-in device. */
export function expectsDeviceChannel(profile: { no_login?: boolean | null }): boolean {
  return !profile.no_login;
}

export function skipDeviceAlert(profile: { no_login?: boolean | null }, rule: string): boolean {
  return !!profile.no_login && (DEVICE_ALERT_RULES as readonly string[]).includes(rule);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Attach a real email to the existing auth user. Never creates a second user,
 * so visits and earnings stay on the same profile id.
 */
export function decideLinkLogin(input: {
  callerCompanyId: string;
  target: { id: string; company_id: string | null; no_login: boolean } | null;
  email: string;
  emailOwnerId: string | null;
}):
  | { ok: true; profileId: string; email: string; createsUser: false }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string } {
  if (!input.target) return { ok: false, status: 404, error: "Technician not found" };
  if (input.target.company_id !== input.callerCompanyId) {
    return { ok: false, status: 403, error: "That technician is in another company" };
  }
  if (!input.target.no_login) return { ok: false, status: 409, error: "This person already has a login" };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || isNoLoginEmail(email)) {
    return { ok: false, status: 400, error: "Enter the email they will use to sign in" };
  }
  if (input.emailOwnerId && input.emailOwnerId !== input.target.id) {
    return { ok: false, status: 409, error: "That email already belongs to another login" };
  }
  return { ok: true, profileId: input.target.id, email, createsUser: false };
}
