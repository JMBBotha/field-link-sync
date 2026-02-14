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
 */
export function allTermsMatchBlob(terms: string[], blob: string): boolean {
  return terms.every(t => termMatchesBlob(t, blob));
}
