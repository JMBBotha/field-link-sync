/**
 * Client search used by the Clients list and the quote, invoice, and Book a job pickers.
 *
 * Matching is case-insensitive and partial: name, company name, first and last name,
 * email (as stored and normalised), phone (formatted text and digits, including the
 * South African 0… / 27… forms), and search_aliases.
 *
 * Rows are loaded for the signed-in company only (profiles.company_id, the same value
 * get_user_company_id uses). A second pass drops any other company_id so an assignee
 * policy cannot pull archived Massair Ind CC history into a Massair CT search.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAllPages";

export interface ClientSearchFields {
  name?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  normalized_email?: string | null;
  phone?: string | null;
  secondary_phone?: string | null;
  normalized_phone?: string | null;
  search_aliases?: string[] | string | null;
  address?: string | null;
  primary_address_line1?: string | null;
  city?: string | null;
}

export interface DirectoryClient extends ClientSearchFields {
  id: string;
  company_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  primary_address_line1: string | null;
  city: string | null;
  status: string | null;
  notes: string | null;
  lead_source: string | null;
  updated_at: string;
  created_at: string;
  is_company: boolean | null;
  client_type: string | null;
  payment_terms_basis: string | null;
  payment_terms_days: number | null;
  latitude: number | null;
  longitude: number | null;
}

export const CLIENT_DIRECTORY_COLUMNS =
  "id, company_id, first_name, last_name, name, company_name, is_company, phone, secondary_phone, email, normalized_phone, normalized_email, search_aliases, primary_address_line1, address, city, status, notes, lead_source, updated_at, created_at, client_type, payment_terms_basis, payment_terms_days, latitude, longitude";

const MIN_PHONE_DIGITS = 3;

/** Same digit rules as public.normalize_phone (leading 27 → 0, 9-digit national → 0…). */
export function normalizePhoneDigits(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("27") && digits.length > 9) digits = "0" + digits.slice(2);
  if (!digits.startsWith("0") && digits.length === 9) digits = "0" + digits;
  return digits;
}

function digitForms(value: string | null | undefined): string[] {
  const raw = String(value ?? "").replace(/\D/g, "");
  const local = normalizePhoneDigits(value);
  const forms = new Set<string>();
  if (raw) forms.add(raw);
  if (local) forms.add(local);
  if (local.startsWith("0") && local.length > 1) forms.add("27" + local.slice(1));
  return [...forms];
}

export function aliasList(value: ClientSearchFields["search_aliases"]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((alias) => typeof alias === "string" && alias.trim().length > 0);
  const text = String(value).trim();
  return text ? [text] : [];
}

function textHit(value: string | null | undefined, q: string, qCollapsed: string): boolean {
  if (!value) return false;
  const hay = value.toLowerCase();
  if (hay.includes(q)) return true;
  if (qCollapsed.length >= MIN_PHONE_DIGITS && hay.replace(/[\s+()-]/g, "").includes(qCollapsed)) return true;
  return false;
}

/** True when query is empty, or any client field matches (case-insensitive, partial). */
export function clientMatchesSearch(client: ClientSearchFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qCollapsed = q.replace(/[\s+()-]/g, "");
  const person = [client.first_name, client.last_name].filter(Boolean).join(" ");
  const texts = [
    client.name,
    client.company_name,
    client.first_name,
    client.last_name,
    person,
    client.email,
    client.normalized_email,
    client.phone,
    client.secondary_phone,
    client.normalized_phone,
    client.address,
    client.primary_address_line1,
    client.city,
    ...aliasList(client.search_aliases),
  ];
  if (texts.some((value) => textHit(value, q, qCollapsed))) return true;

  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length < MIN_PHONE_DIGITS) return false;
  const needles = digitForms(query).filter((form) => form.length >= MIN_PHONE_DIGITS);
  const stored = [client.phone, client.secondary_phone, client.normalized_phone].flatMap((phone) => digitForms(phone));
  return needles.some((needle) => stored.some((hay) => hay.includes(needle)));
}

export function filterClients<T extends ClientSearchFields>(rows: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return rows;
  return rows.filter((row) => clientMatchesSearch(row, q));
}

/** Text blob for the global search index: the same fields, plus both phone digit forms. */
export function clientSearchHaystack(client: ClientSearchFields): string {
  const phones = [client.phone, client.secondary_phone, client.normalized_phone].flatMap((phone) => digitForms(phone));
  return [
    client.name,
    client.company_name,
    client.first_name,
    client.last_name,
    client.email,
    client.normalized_email,
    client.phone,
    client.secondary_phone,
    client.normalized_phone,
    ...phones,
    ...aliasList(client.search_aliases),
    client.address,
    client.primary_address_line1,
    client.city,
  ].filter((part) => part != null && String(part).trim() !== "").join(" ");
}

/**
 * Keep a row only when it belongs to this company (when we know the company)
 * and matches the archived toggle. status null counts as not archived.
 */
export function inCompanyClientScope(
  row: { company_id?: string | null; status?: string | null },
  companyId: string | null,
  archived: boolean,
): boolean {
  if (companyId && row.company_id !== companyId) return false;
  const status = row.status ?? null;
  return archived ? status === "archived" : status !== "archived";
}

/**
 * Every non-archived (or archived, when asked) customer for the signed-in company.
 * Pages past the PostgREST 1,000-row cap. Does not call company_history_*.
 */
export async function loadCompanyClients(companyId: string | null, opts: { archived: boolean }): Promise<DirectoryClient[]> {
  const archived = opts.archived;
  const { data, error } = await fetchAllPages<DirectoryClient>((from, to) => {
    let q = supabase.from("customers").select(CLIENT_DIRECTORY_COLUMNS);
    if (companyId) q = q.eq("company_id", companyId);
    q = archived ? q.eq("status", "archived") : q.or("status.is.null,status.neq.archived");
    return q.order("id", { ascending: true }).range(from, to);
  });
  if (error) throw error;
  return data.filter((row) => inCompanyClientScope(row, companyId, archived));
}
