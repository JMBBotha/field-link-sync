// Loads the signature details for a Field Lynk user (service-role client). Deno only.
import { signatureCompanyFromProfile, type SignatureCompany, type SignaturePerson } from "./emailSignature.ts";

/** The sending company's signature block from its own company_profiles record (default, not archived). */
// deno-lint-ignore no-explicit-any
export async function loadSignatureCompany(sb: any, companyId: string | null | undefined): Promise<SignatureCompany | null> {
  if (!companyId) return null;
  try {
    const { data } = await sb.from("company_profiles")
      .select("legal_name, trading_name, vat_number, phone, whatsapp, email, website, address_lines, logo_url")
      .eq("company_id", companyId).is("archived_at", null)
      .order("is_default", { ascending: false }).order("created_at").limit(1).maybeSingle();
    return signatureCompanyFromProfile(data);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export async function loadSignaturePerson(sb: any, userId: string | null | undefined): Promise<SignaturePerson | null> {
  if (!userId) return null;
  try {
    const { data: p } = await sb.from("profiles")
      .select("full_name, phone, job_title, signature_phone, signature_email, signature_enabled")
      .eq("id", userId).maybeSingle();
    if (!p || p.signature_enabled === false || !p.full_name) return null;
    let email: string | null = p.signature_email || null;
    if (!email) {
      const { data: u } = await sb.auth.admin.getUserById(userId);
      email = u?.user?.email ?? null;
    }
    // Title only when the person filled one in (Johan 14 Oct): no role fallback.
    const title: string | null = p.job_title?.trim() || null;
    return { name: p.full_name, title, phone: p.signature_phone || p.phone || null, email };
  } catch {
    return null;
  }
}

/** A real mailbox the client can reply to, or null (then the default reply-to stays). */
export function replyToFor(person: SignaturePerson | null): string | null {
  const e = person?.email?.trim();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}
