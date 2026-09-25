import { supabase } from "@/integrations/supabase/client";

/** The Quotes list's default sort (QuotesList.tsx): superseded hidden, newest created_at first. */
export const QUOTES_LIST_DEFAULT_SORT = { column: "created_at", ascending: false, excludeStatus: "superseded" } as const;

export function latestQuoteQuery() {
  return supabase
    .from("quotes")
    .select("id, quote_number, customer_name, created_at")
    .neq("status", QUOTES_LIST_DEFAULT_SORT.excludeStatus)
    .order(QUOTES_LIST_DEFAULT_SORT.column, { ascending: QUOTES_LIST_DEFAULT_SORT.ascending })
    .limit(1);
}

/** Same comparator QuotesList uses for its combined feed. */
export const quotesListCompare = (a: { created_at: string }, b: { created_at: string }) => +new Date(b.created_at) - +new Date(a.created_at);
