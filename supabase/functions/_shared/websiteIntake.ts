/**
 * Website intake company (P9, approved by Johan 2026-10-09).
 *
 * New WEBSITE leads that have no trusted company and no matching existing
 * customer go to the company named in admin_settings.website_lead_company_id
 * (0800-BE-COOL) instead of the oldest-company fallback. Only the website
 * intake paths call this; phone / Vapi / Twilio / Mandy are untouched.
 *
 * Rollback without a deploy: delete the admin_settings row and both callers
 * fall straight back to the old oldest-company behaviour.
 */
/** Demo companies are not a destination for live website leads. */
export function liveWebsiteCompanyId(id: unknown, isDemo: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  if (isDemo === true) return null;
  return id;
}

// deno-lint-ignore no-explicit-any
export async function websiteLeadCompanyId(supabase: any): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "website_lead_company_id")
      .maybeSingle();
    const raw = data?.setting_value;
    const id = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? raw.company_id : null);
    if (!id || typeof id !== "string") return null;
    const flagged = await supabase.from("companies").select("id, is_demo").eq("id", id).maybeSingle();
    if (!flagged.error) return liveWebsiteCompanyId(flagged.data?.id, flagged.data?.is_demo);
    const plain = await supabase.from("companies").select("id").eq("id", id).maybeSingle();
    return plain.data?.id ?? null;
  } catch (_e) {
    return null;
  }
}
