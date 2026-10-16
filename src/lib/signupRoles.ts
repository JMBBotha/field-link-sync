/** Five-role sign-up (Field Lynk login v1). Values match profiles.signup_role / handle_new_user(). */
export type SignupRole =
  | "company_new"
  | "company_tech"
  | "company_sales"
  | "massair_dual"
  | "independent";

export const SIGNUP_ROLES: { id: SignupRole; title: string; blurb: string; badge?: string }[] = [
  { id: "company_new", title: "New company", blurb: "Register your AC business, add your team" },
  { id: "company_tech", title: "Company technician", blurb: "Join your company to do jobs" },
  { id: "company_sales", title: "Company salesperson", blurb: "Join your company to work leads" },
  { id: "massair_dual", title: "Massair CT staff", blurb: "Sales & technician in one login", badge: "DUAL ROLE" },
  { id: "independent", title: "Independent sales / technician", blurb: "Freelance on the network and take jobs from companies" },
];

/** Metadata passed to supabase.auth.signUp for each role. Independents reuse the existing participant_type path. */
export function signupMetadata(
  role: SignupRole,
  opts: { fullName: string; companyName?: string; phone?: string; independentKind?: "tech" | "sales" },
): Record<string, string> {
  const base: Record<string, string> = { full_name: opts.fullName };
  if (opts.phone) base.phone = opts.phone;
  if (role === "independent") {
    return { ...base, participant_type: opts.independentKind === "sales" ? "independent_sales" : "independent_tech" };
  }
  const out: Record<string, string> = { ...base, signup_role: role };
  if (role !== "massair_dual" && opts.companyName) out.company_name = opts.companyName;
  return out;
}

/** True while a company / Massair CT sign-up is still waiting for (or was refused) approval. */
export function isAwaitingSignupApproval(profile: any): boolean {
  return !!profile?.signup_role && profile?.network_status !== "approved";
}
