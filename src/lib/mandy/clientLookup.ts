/**
 * find_client for dashboard Mandy. search_customers alone misses a misheard
 * name ("Quibus" is not a substring of "Cobus"), so we also search sounds-like
 * stems and a recent window, then rank with the same matcher as leads.
 */
import type { CustomerSearchResult } from "@/hooks/useCustomerSearch";
import { rankClientHits } from "@/lib/voiceClientMatch";
import { clientSearchTerms, rankSpokenNames } from "@/lib/mandy/nameMatch";

type Row = Partial<CustomerSearchResult> & { id?: string };

export interface ClientLookupDb {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Row[] | null; error: { message?: string } | null }>;
  recentCustomers: () => Promise<{ data: Row[] | null; error: { message?: string } | null }>;
}

function asHit(row: Row, prev?: CustomerSearchResult): CustomerSearchResult {
  return {
    id: String(row.id || prev?.id || ""),
    first_name: row.first_name ?? prev?.first_name ?? null,
    last_name: row.last_name ?? prev?.last_name ?? null,
    company_name: row.company_name ?? prev?.company_name ?? null,
    is_company: row.is_company ?? prev?.is_company ?? null,
    phone: row.phone ?? prev?.phone ?? "",
    email: row.email ?? prev?.email ?? null,
    primary_address_line1: row.primary_address_line1 ?? prev?.primary_address_line1 ?? null,
    city: row.city ?? prev?.city ?? null,
    status: row.status ?? prev?.status ?? null,
    relevance: Math.max(Number(prev?.relevance) || 0, Number(row.relevance) || 0),
  };
}

export async function searchClientsForVoice(query: string, db: ClientLookupDb): Promise<CustomerSearchResult[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const terms = clientSearchTerms(q);
  const [recent, ...searches] = await Promise.all([
    db.recentCustomers(),
    ...terms.map((term) => db.rpc("search_customers", { search_term: term, max_results: 8 })),
  ]);
  const pool = new Map<string, CustomerSearchResult>();
  const add = (rows: Row[] | null | undefined) => {
    for (const row of rows || []) {
      if (!row?.id) continue;
      pool.set(row.id, asHit(row, pool.get(row.id)));
    }
  };
  for (const res of searches) add(res.data);
  add(recent.data);
  for (const hit of rankSpokenNames(q, [...pool.values()], (c) => [c.first_name, c.last_name, c.company_name].filter(Boolean).join(" "))) {
    const row = pool.get(hit.item.id);
    if (row) row.relevance = Math.max(row.relevance, hit.score);
  }
  return rankClientHits(q, [...pool.values()]);
}
