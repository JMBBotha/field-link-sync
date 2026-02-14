/**
 * HVAC search synonym expansion.
 * When a user types a term, we also check its synonyms against the product blob.
 */

const SYNONYM_MAP: Record<string, string[]> = {
  "soft": ["s-drawn"],
  "s-drawn": ["soft"],
  "hard": ["h-drawn"],
  "h-drawn": ["hard"],
  "copper": ["coprl", "cop"],
  "coprl": ["copper"],
  "cop": ["copper"],
  "r410": ["r410a", "r-410"],
  "r410a": ["r410", "r-410"],
  "r-410": ["r410", "r410a"],
  "r22": ["r-22"],
  "r-22": ["r22"],
  "r32": ["r-32"],
  "r-32": ["r32"],
  "midwall": ["mw", "hi-wall"],
  "mw": ["midwall"],
  "hi-wall": ["midwall"],
  "cassette": ["cass"],
  "cass": ["cassette"],
  "ducted": ["duct"],
  "duct": ["ducted"],
  "inverter": ["inv"],
  "inv": ["inverter"],
  "elbow": ["el"],
  "el": ["elbow"],
  "coupling": ["cc"],
  "cc": ["coupling"],
  "nitrogen": ["n2"],
  "n2": ["nitrogen"],
};

/** Get a term + all its synonyms as a group */
export function expandTerm(term: string): string[] {
  const syns = SYNONYM_MAP[term];
  return syns ? [term, ...syns] : [term];
}

/** Get all unique expanded terms across all search terms (for broad DB fetch) */
export function allExpandedTerms(terms: string[]): string[] {
  const set = new Set<string>();
  for (const t of terms) {
    for (const s of expandTerm(t)) set.add(s);
  }
  return Array.from(set);
}

/**
 * Build a Supabase .or() filter string that matches ANY expanded term across multiple fields.
 */
export function buildSupabaseOrFilter(terms: string[], fields: string[]): string {
  const expanded = allExpandedTerms(terms);
  const parts: string[] = [];
  for (const term of expanded) {
    const escaped = term.replace(/[%_]/g, "\\$&");
    for (const field of fields) {
      parts.push(`${field}.ilike.%${escaped}%`);
    }
  }
  return parts.join(",");
}

/**
 * Check if a single search term (or any of its synonyms) appears in the blob.
 */
export function termMatchesBlob(term: string, blob: string): boolean {
  if (blob.includes(term)) return true;
  const synonyms = SYNONYM_MAP[term];
  if (synonyms) {
    return synonyms.some(syn => blob.includes(syn));
  }
  return false;
}

/**
 * Check if ALL search terms match the blob (with synonym expansion).
 * Each original term is a "group" — the product must match at least one synonym from each group.
 */
export function allTermsMatchBlob(terms: string[], blob: string): boolean {
  return terms.every(t => termMatchesBlob(t, blob));
}
