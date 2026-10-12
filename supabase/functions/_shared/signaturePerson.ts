// Loads the signature details for a Field Lynk user (service-role client). Deno only.
import { defaultTitleForRole, type SignaturePerson } from "./emailSignature.ts";

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
    let title: string | null = p.job_title || null;
    if (!title) {
      const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
      const order = ["admin", "sales_rep", "dispatcher", "field_agent"];
      const r = (roles || []).map((x: { role: string }) => x.role).sort((a: string, b: string) => order.indexOf(a) - order.indexOf(b))[0];
      title = defaultTitleForRole(r);
    }
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
