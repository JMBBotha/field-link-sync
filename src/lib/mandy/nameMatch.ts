/**
 * Spoken-name matching for dashboard Mandy.
 * Speech turns "Cobus de Jager" into "Quibus de York" / "Quibus de Jager".
 * A plain ILIKE of the whole phrase misses the lead. This ranks sounds-like,
 * partial, and first-or-last hits, and ignores particles such as "de".
 */

const PARTICLES = new Set(["de", "van", "der", "den", "du", "le", "la", "ten", "ter", "von", "da", "di", "del", "the", "of"]);

export function nameTokens(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !PARTICLES.has(t));
}

/** Coarse sounds-like key. "quibus" and "cobus" both become "kabas". */
export function phoneticKey(token: string): string {
  let s = String(token || "").toLowerCase();
  s = s.replace(/^qu/, "k");
  s = s.replace(/^c(?=[aou])/, "k");
  s = s.replace(/^c(?=[eiy])/, "s");
  s = s.replace(/ph/g, "f").replace(/ck/g, "k").replace(/sch/g, "sk");
  s = s.replace(/[aeiouy]+/g, "a");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

/** Extra spellings to ILIKE. "quibus" also searches "cobus". */
export function phoneticStems(token: string): string[] {
  const t = String(token || "").toLowerCase();
  const out = new Set<string>();
  if (/^qu[aeiouy]/.test(t) && t.length > 3) out.add("co" + t.slice(3));
  if (/^co/.test(t) && t.length > 3) out.add("qui" + t.slice(2));
  if (/^k[aeiouy]/.test(t)) out.add("c" + t.slice(1));
  if (/^c[aeiouy]/.test(t)) out.add("k" + t.slice(1));
  return [...out].filter((s) => s.length >= 3 && s !== t);
}

/** Terms to send to search: the phrase, each word, and sounds-like stems. */
export function clientSearchTerms(query: string): string[] {
  const q = String(query || "").trim();
  const terms = new Set<string>();
  if (q.length >= 2) terms.add(q);
  for (const t of nameTokens(q)) {
    if (t.length >= 3) terms.add(t);
    for (const s of phoneticStems(t)) terms.add(s);
  }
  return [...terms].slice(0, 8);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (ka && ka === kb) return 0.9;
  if ((a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 3) return 0.92;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 3) return 0.84;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.72 ? ratio : ratio * 0.45;
}

export interface RankedName<T> {
  item: T;
  score: number;
  name: string;
}

/**
 * Closest names first. A strong sounds-like token (Quibus ~ Cobus) stays
 * above the floor even when another word was misheard (York vs Jager).
 */
export function rankSpokenNames<T>(query: string, items: T[], nameOf: (item: T) => string, limit = 4): RankedName<T>[] {
  const qTokens = nameTokens(query);
  if (!qTokens.length) return [];
  const scored = items.map((item) => {
    const name = String(nameOf(item) || "");
    const nTokens = nameTokens(name);
    if (!nTokens.length) return { item, score: 0, name };
    let sum = 0;
    let hits = 0;
    let strong = false;
    for (const qt of qTokens) {
      let best = 0;
      for (const nt of nTokens) best = Math.max(best, tokenSimilarity(qt, nt));
      if (best >= 0.55) hits += 1;
      if (best >= 0.88) strong = true;
      sum += best;
    }
    const coverage = hits / qTokens.length;
    const first = tokenSimilarity(qTokens[0], nTokens[0]);
    const last = tokenSimilarity(qTokens[qTokens.length - 1], nTokens[nTokens.length - 1]);
    let score = (sum / qTokens.length) * 0.65 + coverage * 0.25 + Math.max(first, last) * 0.1;
    if (coverage === 1 && qTokens.length >= 2) score = Math.max(score, 0.9);
    if (strong) score = Math.max(score, 0.62);
    if (qTokens.join(" ") === nTokens.join(" ")) score = 1;
    return { item, score, name };
  });
  return scored
    .filter((s) => s.score >= 0.55)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}
