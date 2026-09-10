/**
 * Shared client-match confidence rules for quote-by-voice.
 *
 * STT mishears names ("Vikas Suman" for Wicus Schoeman), so a single weak fuzzy
 * hit must NEVER be auto-assigned. These helpers filter out name-only noise,
 * rank the best hits first, and decide when auto-selection is safe.
 */
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";

export const MAX_CLIENT_CHIPS = 5;
const AUTO_RELEVANCE = 0.55;
const MIN_NAME_RELEVANCE = 0.3;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const clientDisplayName = (c: CustomerSearchResult) =>
  [c.company_name, [c.first_name, c.last_name].filter(Boolean).join(" ")].filter(Boolean).join(" — ") || c.phone;

const digits = (s: string) => s.replace(/\D+/g, "");

/** Phone/email queries are strong signals; name queries are the risky ones. */
function isStrongIdentifierMatch(query: string, c: CustomerSearchResult): boolean {
  const qd = digits(query);
  if (qd.length >= 7 && digits(c.phone || "").includes(qd)) return true;
  const q = norm(query);
  if (q.includes("@") && (c.email || "").toLowerCase() === query.trim().toLowerCase()) return true;
  return false;
}

/** Exact/substring agreement between the spoken query and the customer's name. */
export function isClearNameMatch(query: string, c: CustomerSearchResult): boolean {
  const q = norm(query);
  if (q.length < 3) return false;
  const candidates = [
    [c.first_name, c.last_name].filter(Boolean).join(" "),
    c.company_name || "",
    clientDisplayName(c),
  ].map(norm).filter(Boolean);
  return candidates.some((n) => n === q || n.includes(q) || q.includes(n));
}

/** Drop name-only noise, then rank best first and cap the list. */
export function rankClientHits(query: string, hits: CustomerSearchResult[]): CustomerSearchResult[] {
  return hits
    .filter((c) => isStrongIdentifierMatch(query, c) || isClearNameMatch(query, c) || (c.relevance ?? 0) >= MIN_NAME_RELEVANCE)
    .sort((a, b) => {
      const ca = isClearNameMatch(query, a) ? 1 : 0;
      const cb = isClearNameMatch(query, b) ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (b.relevance ?? 0) - (a.relevance ?? 0);
    })
    .slice(0, MAX_CLIENT_CHIPS);
}

/** Only auto-assign when we are genuinely confident. */
export function isHighConfidence(query: string, c: CustomerSearchResult): boolean {
  return (c.relevance ?? 0) >= AUTO_RELEVANCE || isClearNameMatch(query, c) || isStrongIdentifierMatch(query, c);
}
