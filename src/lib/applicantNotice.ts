import { formatDistanceToNow } from "date-fns";
import { SIGNUP_ROLES } from "@/lib/signupRoles";

export type SignupApplicant = {
  email?: string | null;
  full_name?: string | null;
  signup_role?: string | null;
  dispatch_role?: string | null;
  invite_role?: string | null;
  invite_lane?: string | null;
  source?: string | null;
  created?: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const roleTitle = (id: string) => SIGNUP_ROLES.find((role) => role.id === id)?.title ?? id.replace(/_/g, " ");

const whenLabel = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDistanceToNow(date, { addSuffix: true });
};

/** Bell row for a network_applicant. Metadata wins; the admin RPC fills gaps. */
export function applicantNotice(input: {
  metadata?: Record<string, unknown> | null;
  resolved?: SignupApplicant | null;
  createdAt?: string | null;
}): { name: string; email: string; role: string; when: string; source: string } {
  const meta = input.metadata ?? {};
  const resolved = input.resolved ?? {};
  const name = text(meta.full_name) || text(resolved.full_name) || "New sign-up";
  const email = text(meta.email) || text(resolved.email) || "Email not on the notice";
  const signup = text(meta.signup_role) || text(resolved.signup_role);
  const inviteRole = text(meta.invite_role) || text(resolved.invite_role);
  const lane = text(meta.invite_lane) || text(meta.dispatch_role) || text(resolved.invite_lane) || text(resolved.dispatch_role);
  const source = text(meta.source) || text(resolved.source) || (inviteRole ? "team_invite" : "public_signup");
  let role = signup ? roleTitle(signup) : "";
  if (!role && (inviteRole || lane)) role = `Invited ${[inviteRole, lane].filter(Boolean).join(" / ")}`;
  if (!role) role = "Role not on the notice";
  const rawWhen = text(meta.created) || text(resolved.created) || text(input.createdAt);
  return { name, email, role, when: rawWhen ? whenLabel(rawWhen) : "time not on the notice", source };
}

/** Team invitees are not public company sign-ups. Do not approve them. */
export function isInviteeSignup(detail: { source?: string | null } | null | undefined): boolean {
  return detail?.source === "team_invite";
}
