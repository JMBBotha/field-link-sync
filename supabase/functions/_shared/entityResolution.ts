/**
 * Fuzzy entity resolution — shared confidence policy.
 *
 * Pure, dependency-free logic so the exact same thresholds govern the typed
 * command bar, the NL text assistant and Vapi voice tool calls.
 *
 * Decisions:
 *   auto     -> one clear winner, safe to select without asking (READ actions only)
 *   clarify  -> plausible matches, show/speak "Did you mean ...?" with options
 *   retry    -> nothing close enough; ask the user to repeat, refine or spell it
 */

export type EntityType =
  | "customer" | "lead" | "job" | "quote" | "product" | "staff" | "all";

export interface EntityCandidate {
  entity_type: Exclude<EntityType, "all">;
  id: string;
  label: string;
  sublabel: string | null;
  reference: string | null;
  score: number;
}

export type ResolutionDecision = "auto" | "clarify" | "retry";

export interface EntityResolution {
  decision: ResolutionDecision;
  query: string;
  entity_type: EntityType;
  candidates: EntityCandidate[];
  /** Only set when decision === "auto". */
  chosen: EntityCandidate | null;
  /** Ready-to-speak / ready-to-render prompt. */
  prompt: string;
}

export const CONFIDENCE = {
  /** At/above this a single candidate can be auto-selected. */
  AUTO: 0.85,
  /** Required gap to the runner-up before auto-selecting. */
  AUTO_MARGIN: 0.12,
  /** At/above this we offer a "Did you mean...?" list. */
  CLARIFY: 0.4,
  /** Anything below CLARIFY is discarded. */
  FLOOR: 0.25,
} as const;

const NOUN: Record<string, string> = {
  customer: "customer",
  lead: "lead",
  job: "job",
  quote: "quote",
  product: "product",
  staff: "staff member",
  all: "record",
};

export function describeCandidate(c: EntityCandidate): string {
  const extra = c.sublabel || c.reference;
  return extra ? `${c.label} (${extra})` : c.label;
}

/**
 * Applies the confidence policy to scored candidates from
 * search_entities_fuzzy(). `riskyAction` forces a confirmation step even for a
 * high-confidence single hit, so destructive/write flows are never executed on
 * an inferred match.
 */
export function resolveCandidates(
  query: string,
  entityType: EntityType,
  raw: EntityCandidate[],
  opts: { riskyAction?: boolean } = {},
): EntityResolution {
  const noun = NOUN[entityType] ?? "record";
  const candidates = [...(raw ?? [])]
    .filter((c) => c && Number.isFinite(c.score) && c.score >= CONFIDENCE.FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (candidates.length === 0) {
    return {
      decision: "retry", query, entity_type: entityType, candidates, chosen: null,
      prompt: `I couldn't find a ${noun} matching "${query}". Could you repeat it, spell the name, or give me a number or phone number instead?`,
    };
  }

  const [top, second] = candidates;
  const margin = top.score - (second?.score ?? 0);
  const confident = top.score >= CONFIDENCE.AUTO &&
    (candidates.length === 1 || margin >= CONFIDENCE.AUTO_MARGIN);

  if (confident && !opts.riskyAction) {
    return {
      decision: "auto", query, entity_type: entityType, candidates, chosen: top,
      prompt: `Using ${describeCandidate(top)}.`,
    };
  }

  if (top.score >= CONFIDENCE.CLARIFY) {
    const list = candidates.map((c, i) => `${i + 1}. ${describeCandidate(c)}`).join("\n");
    return {
      decision: "clarify", query, entity_type: entityType, candidates, chosen: null,
      prompt: confident
        ? `Just to confirm before I continue — did you mean ${describeCandidate(top)}?`
        : `I found a few possible matches for "${query}". Did you mean:\n${list}\nWhich one?`,
    };
  }

  return {
    decision: "retry", query, entity_type: entityType, candidates: [], chosen: null,
    prompt: `I'm not confident about "${query}". Could you repeat it, spell the name, or give me a reference number?`,
  };
}
