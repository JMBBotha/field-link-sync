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
  // Pipe size aliases (both directions: typed fractions ↔ metric/unicode)
  "1/4": ["6.35", "6mm", "cu6", "¼", "1/4\"", "1/4id"],
  "¼": ["1/4", "6.35", "6mm", "cu6"],
  "3/8": ["9.52", "10mm", "cu10", "3/8\"", "3/8id"],
  "1/2": ["12.7", "12mm", "cu12", "½", "1/2\"", "1/2id"],
  "½": ["1/2", "12.7", "12mm", "cu12"],
  "5/8": ["15.88", "16mm", "cu16", "5/8\"", "5/8id"],
  "3/4": ["19.05", "19mm", "cu19", "¾", "3/4\"", "3/4id"],
  "¾": ["3/4", "19.05", "19mm", "cu19"],
  "7/8": ["22.22", "22mm", "cu22", "7/8\"", "7/8id"],
  "1.1/8": ["1-1/8", "28.58", "28mm"],
  "1.3/8": ["1-3/8", "34.93", "35mm"],
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
  // Also try with common fraction variants embedded in longer strings
  // e.g., "1/4id" should match when searching "1/4"
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
