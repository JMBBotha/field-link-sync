/**
 * useQuote — the single source of truth for reading a quote anywhere in the app.
 *
 * One React Query key, one join shape, used by:
 *   - QuoteBuilder (via QuoteContext for writes; this hook for peripheral reads)
 *   - Quotes list detail
 *   - Lead detail
 *   - Customer detail
 *   - Job detail
 *   - PDF renderer
 *   - Client-facing proposal view
 *
 * After any write, callers should invalidate the shared key so every surface
 * refreshes at once:
 *   queryClient.invalidateQueries({ queryKey: quoteKeys.single(id) });
 *   queryClient.invalidateQueries({ queryKey: quoteKeys.lists() });
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const quoteKeys = {
  all: ["quote"] as const,
  lists: () => [...quoteKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...quoteKeys.lists(), filters] as const,
  single: (id: string | null | undefined) => [...quoteKeys.all, "single", id] as const,
  byLead: (leadId: string | null | undefined) => [...quoteKeys.all, "by-lead", leadId] as const,
  byCustomer: (customerId: string | null | undefined) =>
    [...quoteKeys.all, "by-customer", customerId] as const,
};

export interface QuoteLineItem {
  id: string;
  quote_id: string;
  area_id: string | null;
  parent_item_id: string | null;
  item_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number | null;
  length: number | null;
  is_bundle: boolean;
  item_type: string | null;
  source: string;
  sort_order: number;
  metadata: Record<string, unknown>;
}

export interface QuoteArea {
  id: string;
  quote_id: string;
  name: string;
  sort_order: number;
}

export interface FullQuote {
  id: string;
  quote_number: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  lead_id: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  terms_text: string | null;
  reference_text: string | null;
  valid_until: string | null;
  discount_type: string | null;
  discount_value: number | null;
  public_token: string | null;
  visual_sections: unknown;
  created_at: string;
  updated_at: string;
  company_id: string | null;
  location_id: string | null;
  customers: { id: string; name: string; email: string | null; phone: string; address: string | null } | null;
  leads: { id: string; customer_name: string; service_type: string } | null;
  areas: QuoteArea[];
  items: QuoteLineItem[];
}

async function fetchQuote(quoteId: string): Promise<FullQuote | null> {
  const [quoteRes, areasRes, itemsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select("*, customers(id, name, email, phone, address), leads(id, customer_name, service_type)")
      .eq("id", quoteId)
      .maybeSingle(),
    supabase.from("quote_areas").select("*").eq("quote_id", quoteId).order("sort_order"),
    supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order"),
  ]);

  if (quoteRes.error) throw quoteRes.error;
  if (!quoteRes.data) return null;
  if (areasRes.error) throw areasRes.error;
  if (itemsRes.error) throw itemsRes.error;

  return {
    ...(quoteRes.data as unknown as FullQuote),
    areas: (areasRes.data as unknown as QuoteArea[]) || [],
    items: (itemsRes.data as unknown as QuoteLineItem[]) || [],
  };
}

/** Fetch one full quote (meta + areas + items + customer + lead). */
export function useQuote(quoteId: string | null | undefined) {
  return useQuery({
    queryKey: quoteKeys.single(quoteId ?? null),
    queryFn: () => fetchQuote(quoteId as string),
    enabled: !!quoteId,
    staleTime: 15_000,
  });
}

/**
 * Look up the most recent draft quote linked to a given lead, if any.
 * Used by the builder's "empty-quote safeguard" — never create a second
 * draft when one already exists for the same lead.
 */
export async function findLatestDraftForLead(leadId: string): Promise<string | null> {
  const { data } = await supabase
    .from("quotes")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "draft")
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Look up the most recent draft quote linked to a given customer, if any.
 * Same "empty-quote safeguard" idea, scoped to customer.
 */
export async function findLatestDraftForCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("quotes")
    .select("id")
    .eq("customer_id", customerId)
    .is("lead_id", null)
    .eq("status", "draft")
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

