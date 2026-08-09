import { supabase } from "@/integrations/supabase/client";
import {
  CONFIDENCE,
  describeCandidate,
  resolveCandidates,
  type EntityCandidate,
  type EntityResolution,
  type EntityType,
  type ResolutionDecision,
} from "../../supabase/functions/_shared/entityResolution";

export { CONFIDENCE, describeCandidate, resolveCandidates };
export type { EntityCandidate, EntityResolution, EntityType, ResolutionDecision };

export interface ResolveOptions {
  /** Force a confirmation step even for a high-confidence match. */
  riskyAction?: boolean;
  companyId?: string | null;
  limit?: number;
}

/**
 * Fuzzy-resolves free text (typed or transcribed) to real records via the
 * pg_trgm-backed search_entities_fuzzy() function, then applies the shared
 * confidence policy. RLS still governs which rows are visible.
 */
export async function resolveEntity(
  entityType: EntityType,
  query: string,
  opts: ResolveOptions = {},
): Promise<EntityResolution> {
  const { data, error } = await supabase.rpc("search_entities_fuzzy", {
    p_entity_type: entityType,
    p_query: query,
    p_company_id: opts.companyId ?? null,
    p_limit: opts.limit ?? 5,
  });
  if (error) throw error;
  return resolveCandidates(query, entityType, (data ?? []) as EntityCandidate[], {
    riskyAction: opts.riskyAction,
  });
}

/** Audit which candidate was ultimately used (or that the user cancelled). */
export async function logEntityResolution(
  resolution: EntityResolution,
  chosen: EntityCandidate | null,
  decision: ResolutionDecision | "confirmed" | "cancelled",
  channel: "text" | "voice" = "text",
): Promise<void> {
  const { error } = await supabase.rpc("log_entity_resolution", {
    p_entity_type: resolution.entity_type,
    p_query: resolution.query,
    p_decision: decision,
    p_chosen_id: chosen?.id ?? null,
    p_chosen_label: chosen?.label ?? null,
    p_score: chosen?.score ?? null,
    p_candidates: resolution.candidates.map((c) => ({
      id: c.id,
      entity_type: c.entity_type,
      label: c.label,
      score: c.score,
    })),
    p_channel: channel,
  });
  if (error) console.warn("[entityResolution] audit log failed", error.message);
}
