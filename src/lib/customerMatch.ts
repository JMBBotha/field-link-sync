import { supabase } from "@/integrations/supabase/client";

/**
 * Normalize a phone number to a comparable form.
 * Strips all non-digits; if it looks like a SA local number (starts with 0),
 * converts to international 27... form. Returns null if fewer than 7 digits.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.startsWith("0")) return "27" + digits.slice(1);
  return digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

export interface CustomerMatch {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  matchedOn: "phone" | "email" | "both";
  jobCount?: number;
}

/**
 * Look up an existing customer within a company by phone and/or email.
 * Uses digit-only substring compare on phone so leading-zero / +27
 * variations still match. Returns the best (most-recent) match, or null.
 */
export async function findCustomerMatch(
  companyId: string,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<CustomerMatch | null> {
  const nPhone = normalizePhone(phone);
  const nEmail = normalizeEmail(email);
  if (!nPhone && !nEmail) return null;

  // Match on the last 9 digits of the phone (covers 0XXXXXXXXX vs +27XXXXXXXXX).
  const phoneTail = nPhone ? nPhone.slice(-9) : null;

  const filters: string[] = [];
  if (phoneTail) filters.push(`phone.ilike.%${phoneTail}%`);
  if (nEmail) filters.push(`email.ilike.${nEmail}`);

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email, created_at")
    .eq("company_id", companyId)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const c = data[0];
  const phoneHit = !!phoneTail && !!c.phone && c.phone.replace(/\D/g, "").endsWith(phoneTail);
  const emailHit = !!nEmail && !!c.email && c.email.toLowerCase() === nEmail;
  const matchedOn: CustomerMatch["matchedOn"] =
    phoneHit && emailHit ? "both" : phoneHit ? "phone" : "email";

  return { id: c.id, name: c.name, phone: c.phone, email: c.email, matchedOn };
}
