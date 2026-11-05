import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { jsonBoolean, jsonNumber, jsonObject, jsonString } from "@/lib/jsonValue";

/**
 * Lock state of a quote (Johan 2026-10-23): once accepted, reps/techs can't change it; once invoiced
 * nobody can (variation or credit note instead). The server (migration 0029) enforces this; this hook
 * only drives the banner / read-only UI.
 */
export type QuoteLockStateName = "open" | "accepted_locked" | "confirmed_locked" | "accepted_unlocked" | "invoiced";

export interface QuoteLockState {
  state: QuoteLockStateName;
  status: string | null;
  locked_at: string | null;
  locked_reason: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  is_admin: boolean;
  can_edit: boolean;
  can_unlock: boolean;
  can_relock: boolean;
  can_variation: boolean;
  can_correct_client: boolean;
  last_unlock: { at: string; reason: string | null; by: string | null } | null;
  variations: { id: string; quote_number: string | null; status: string | null; total: number | null }[];
  parent: { id: string; quote_number: string | null } | null;
  is_variation: boolean;
  variation_kind: string | null;
}

export const quoteLockKey = (quoteId: string | null | undefined) => ["quote-lock", quoteId ?? null] as const;

const LOCK_STATES: QuoteLockStateName[] = ["open", "accepted_locked", "confirmed_locked", "accepted_unlocked", "invoiced"];

function quoteLockFromJson(value: Json | null): QuoteLockState | null {
  const row = jsonObject(value);
  const state = row?.state;
  if (!row || typeof state !== "string" || !LOCK_STATES.includes(state as QuoteLockStateName)) return null;
  const unlock = jsonObject(row.last_unlock);
  const parent = jsonObject(row.parent);
  const variations = Array.isArray(row.variations) ? row.variations.flatMap((item) => {
    const line = jsonObject(item);
    if (!line || typeof line.id !== "string") return [];
    return [{ id: line.id, quote_number: jsonString(line.quote_number), status: jsonString(line.status), total: jsonNumber(line.total) }];
  }) : [];
  return {
    state: state as QuoteLockStateName,
    status: jsonString(row.status),
    locked_at: jsonString(row.locked_at),
    locked_reason: jsonString(row.locked_reason),
    invoice_number: jsonString(row.invoice_number),
    invoice_status: jsonString(row.invoice_status),
    is_admin: jsonBoolean(row.is_admin),
    can_edit: jsonBoolean(row.can_edit),
    can_unlock: jsonBoolean(row.can_unlock),
    can_relock: jsonBoolean(row.can_relock),
    can_variation: jsonBoolean(row.can_variation),
    can_correct_client: jsonBoolean(row.can_correct_client),
    last_unlock: unlock && typeof unlock.at === "string" ? { at: unlock.at, reason: jsonString(unlock.reason), by: jsonString(unlock.by) } : null,
    variations,
    parent: parent && typeof parent.id === "string" ? { id: parent.id, quote_number: jsonString(parent.quote_number) } : null,
    is_variation: jsonBoolean(row.is_variation),
    variation_kind: jsonString(row.variation_kind),
  };
}

export async function fetchQuoteLockState(quoteId: string): Promise<QuoteLockState | null> {
  const { data, error } = await supabase.rpc("quote_lock_state", { p_quote_id: quoteId });
  // Until 0029 is applied the RPC doesn't exist: behave exactly as before (no banner, editable).
  if (error) { console.warn("[quote-lock] state unavailable", error.message); return null; }
  return quoteLockFromJson(data);
}

/** True when the UI should show the quote read-only. Unknown state (null) keeps the old behaviour. */
export const isQuoteReadOnly = (s: QuoteLockState | null | undefined) => !!s && !s.can_edit;

export function useQuoteLock(quoteId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: quoteLockKey(quoteId),
    queryFn: () => fetchQuoteLockState(quoteId as string),
    enabled: !!quoteId,
    staleTime: 15_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: quoteLockKey(quoteId) });
    void qc.invalidateQueries({ queryKey: ["quote-document", quoteId] });
    void qc.invalidateQueries({ queryKey: ["quote-document-items", quoteId] });
    void qc.invalidateQueries({ queryKey: ["quotes"] });
  };
  return { lock: query.data ?? null, loading: query.isLoading, refresh };
}
