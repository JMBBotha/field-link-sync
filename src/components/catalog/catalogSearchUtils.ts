/**
 * Shared search utilities extracted from ProductCatalogBrowser.
 * Used by both ProductCatalogBrowser and InventoryList.
 */
import Fuse from "fuse.js";
import type { CatalogFilters, SortOption } from "./CatalogFilterBar";

// ── Types ───────────────────────────────────────────────
export interface SearchableProduct {
  id: string;
  product_code: string;
  description: string;
  category: string;
  subcategory?: string | null;
  supplier_id?: string;
  supplier_name?: string;
  cost_price?: number;
  selling_price?: number;
  is_price_on_request?: boolean;
  btu_rating?: number | null;
  refrigerant_type?: string | null;
  pipe_size?: string | null;
  short_name?: string | null;
  default_markup_percent?: number;
  quote_usage_count?: number;
  search_blob?: string;
}


// ── Derive helpers ──────────────────────────────────────
export function deriveSpeedType(p: SearchableProduct): string {
  const text = `${p.category} ${p.description} ${p.short_name || ""}`.toLowerCase();
  if (text.includes("inverter") || text.includes("inv ")) return "Inverter";
  if (text.includes("fixed speed") || text.includes("fs ")) return "Fixed Speed";
  return "";
}

export function deriveUnitType(p: SearchableProduct): string {
  const text = `${p.category} ${p.description} ${p.short_name || ""}`.toLowerCase();
  const map: [string, string][] = [
    ["midwall", "Midwall"], ["cassette", "Cassette"], ["ducted", "Ducted"],
    ["under ceiling", "Under Ceiling"], ["floor standing", "Floor Standing"],
    ["window wall", "Window Wall"], ["portable", "Portable"],
    ["rooftop", "Rooftop Package"], ["chiller", "Air Cooled Chiller"],
    ["accessor", "Accessories"], ["large ducted", "Large Ducted"],
  ];
  for (const [kw, label] of map) {
    if (text.includes(kw)) return label;
  }
  return "";
}

export function derivePhase(p: SearchableProduct): string {
  const text = `${p.product_code} ${p.description}`.toLowerCase();
  if (text.includes("3ph") || text.includes("three phase") || text.includes("3-phase")) return "3Ph";
  if (text.includes("1ph") || text.includes("single phase") || text.includes("1-phase")) return "1Ph";
  return "";
}

export function deriveBrand(p: SearchableProduct): string {
  const supplierName = (p.supplier_name || "").toLowerCase();
  if (supplierName.includes("samsung")) return "Samsung";
  if (supplierName.includes("alliance")) return "Alliance";
  const code = (p.product_code || "").toUpperCase();
  if (code.startsWith("FOUR")) return "Alliance";
  if (supplierName) {
    // Capitalize first letter of each word
    return supplierName.replace(/\b\w/g, c => c.toUpperCase());
  }
  return "Midea";
}

export function deriveBtuBucket(p: SearchableProduct): string {
  const btu = p.btu_rating;
  if (!btu) return "";
  const k = btu / 1000;
  if (k >= 76) return "76K+";
  const buckets = [9, 12, 18, 24, 34, 36, 48, 60];
  const closest = buckets.reduce((prev, curr) => Math.abs(curr - k) < Math.abs(prev - k) ? curr : prev);
  return `${closest}K`;
}

export function derivePipeSize(p: SearchableProduct): string {
  return (p.pipe_size || "").trim();
}

/** Build a synthetic search string with BTU variants and normalized brand for better Fuse.js matching */
export function buildSearchBlob(p: SearchableProduct): string {
  const parts = [p.product_code, p.short_name || "", p.description, p.category, p.subcategory || "", p.supplier_name || "", p.refrigerant_type || "", p.pipe_size || ""];
  const brand = deriveBrand(p);
  parts.push(brand);
  if (p.btu_rating) {
    const k = Math.round(p.btu_rating / 1000);
    parts.push(`${k}K`, `${p.btu_rating}`, `${k} 000`);
  }
  const speed = deriveSpeedType(p);
  if (speed) parts.push(speed);
  return parts.join(" ");
}

export function matchesFilters(p: SearchableProduct, f: CatalogFilters): boolean {
  if (f.speedType !== "__all__" && deriveSpeedType(p) !== f.speedType) return false;
  if (f.unitType !== "__all__" && deriveUnitType(p) !== f.unitType) return false;
  if (f.btu !== "__all__" && deriveBtuBucket(p) !== f.btu) return false;
  if (f.refrigerant !== "__all__" && (p.refrigerant_type || "").toUpperCase() !== f.refrigerant.toUpperCase()) return false;
  if (f.phase !== "__all__" && derivePhase(p) !== f.phase) return false;
  if (f.brand !== "__all__" && deriveBrand(p) !== f.brand) return false;
  if (f.pipeSize !== "__all__" && derivePipeSize(p) !== f.pipeSize) return false;
  if (f.priceMin && (p.selling_price ?? 0) < parseFloat(f.priceMin)) return false;
  if (f.priceMax && (p.selling_price ?? 0) > parseFloat(f.priceMax)) return false;
  return true;
}

// ── Levenshtein distance for fuzzy brand matching ───────
export const levenshteinDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
};

export const KNOWN_BRANDS: { name: string; value: string }[] = [
  { name: "midea", value: "Midea" },
  { name: "alliance", value: "Alliance" },
  { name: "samsung", value: "Samsung" },
  { name: "daikin", value: "Daikin" },
  { name: "lg", value: "LG" },
];

// ── Smart query preprocessing ───────────────────────────
export interface PreprocessedQuery {
  cleanedQuery: string;
  autoFilters: Partial<CatalogFilters>;
  autoSort?: SortOption;
}

const BRAND_PATTERNS: { pattern: RegExp; value: string }[] = [
  { pattern: /\bmidea\b/gi, value: "Midea" },
  { pattern: /\balliance\b/gi, value: "Alliance" },
  { pattern: /\bsamsung\b/gi, value: "Samsung" },
  { pattern: /\bdaikin\b/gi, value: "Daikin" },
  { pattern: /\blg\b/gi, value: "LG" },
];

const BTU_PREPROCESS_PATTERNS: { pattern: RegExp; bucket: string }[] = [
  { pattern: /\b9\s*000\b/gi, bucket: "9K" },
  { pattern: /\b12\s*000\b/gi, bucket: "12K" },
  { pattern: /\b18\s*000\b/gi, bucket: "18K" },
  { pattern: /\b24\s*000\b/gi, bucket: "24K" },
  { pattern: /\b34\s*000\b/gi, bucket: "34K" },
  { pattern: /\b36\s*000\b/gi, bucket: "36K" },
  { pattern: /\b48\s*000\b/gi, bucket: "48K" },
  { pattern: /\b60\s*000\b/gi, bucket: "60K" },
];

const REFRIGERANT_PREPROCESS: { pattern: RegExp; value: string }[] = [
  { pattern: /\br32\b/gi, value: "R32" },
  { pattern: /\br410a?\b/gi, value: "R410A" },
];

const SPEED_PREPROCESS: { pattern: RegExp; value: string }[] = [
  { pattern: /\b(?:inverter|inv)\b/gi, value: "Inverter" },
  { pattern: /\b(?:fixed\s*speed?|non[- ]?inverter)\b/gi, value: "Fixed Speed" },
];

const PHASE_PREPROCESS: { pattern: RegExp; value: string }[] = [
  { pattern: /\b(?:3ph|three\s*phase|3[- ]?phase)\b/gi, value: "3Ph" },
  { pattern: /\b(?:1ph|single\s*phase|1[- ]?phase)\b/gi, value: "1Ph" },
];

const UNIT_TYPE_PREPROCESS: { pattern: RegExp; value: string }[] = [
  { pattern: /\bunder\s+ceiling\b/gi, value: "Under Ceiling" },
  { pattern: /\bfloor\s+standing\b/gi, value: "Floor Standing" },
  { pattern: /\bwindow\s+wall\b/gi, value: "Window Wall" },
  { pattern: /\brooftop\s+package\b/gi, value: "Rooftop Package" },
  { pattern: /\bair\s+cooled\s+chiller\b/gi, value: "Air Cooled Chiller" },
  { pattern: /\blarge\s+ducted\b/gi, value: "Large Ducted" },
  { pattern: /\bcass?ett?e\b/gi, value: "Cassette" },
  { pattern: /\bmidwall\b/gi, value: "Midwall" },
  { pattern: /\bducted\b/gi, value: "Ducted" },
  { pattern: /\bportable\b/gi, value: "Portable" },
  { pattern: /\bchiller\b/gi, value: "Air Cooled Chiller" },
  { pattern: /\bbreezeless\b/gi, value: "BREEZELESS E R32 INVERTER" },
];

export function preprocessQuery(query: string, currentFilters: CatalogFilters): PreprocessedQuery {
  let q = query;
  const autoFilters: Partial<CatalogFilters> = {};
  let autoSort: SortOption | undefined;

  const betweenMatch = q.match(/\bbetween\s*(?:R\s*)?(\d{4,7})\s*(?:and|to)\s*(?:R\s*)?(\d{4,7})/i);
  if (betweenMatch) {
    autoFilters.priceMin = betweenMatch[1];
    autoFilters.priceMax = betweenMatch[2];
    q = q.replace(betweenMatch[0], "");
  } else {
    const underMatch = q.match(/\bunder\s*(?:R\s*)?(\d{4,7})/i);
    if (underMatch) {
      autoFilters.priceMax = underMatch[1];
      q = q.replace(underMatch[0], "");
    }
  }
  if (/\bcheapest\b/i.test(q)) {
    autoSort = "price_asc";
    q = q.replace(/\bcheapest\b/gi, "");
  }

  for (const bp of BRAND_PATTERNS) {
    if (bp.pattern.test(q) && currentFilters.brand === "__all__") {
      autoFilters.brand = bp.value;
      q = q.replace(bp.pattern, "");
    }
  }

  if (!autoFilters.brand && currentFilters.brand === "__all__") {
    const words = q.split(/\s+/);
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi].toLowerCase();
      if (w.length < 2) continue;
      for (const kb of KNOWN_BRANDS) {
        const dist = levenshteinDistance(w, kb.name);
        const lenDiff = Math.abs(w.length - kb.name.length);
        if (dist > 0 && ((dist <= 2 && lenDiff <= 1) || dist <= 1)) {
          autoFilters.brand = kb.value;
          words.splice(wi, 1);
          q = words.join(" ");
          break;
        }
      }
      if (autoFilters.brand) break;
    }
  }

  if (currentFilters.unitType === "__all__") {
    for (const ut of UNIT_TYPE_PREPROCESS) {
      if (ut.pattern.test(q)) {
        autoFilters.unitType = ut.value;
        q = q.replace(ut.pattern, "");
        break;
      }
    }
  }

  for (const sp of SPEED_PREPROCESS) {
    if (sp.pattern.test(q) && currentFilters.speedType === "__all__") {
      autoFilters.speedType = sp.value;
      q = q.replace(sp.pattern, "");
    }
  }
  for (const rp of REFRIGERANT_PREPROCESS) {
    if (rp.pattern.test(q) && currentFilters.refrigerant === "__all__") {
      autoFilters.refrigerant = rp.value;
      q = q.replace(rp.pattern, "");
    }
  }
  for (const pp of PHASE_PREPROCESS) {
    if (pp.pattern.test(q) && currentFilters.phase === "__all__") {
      autoFilters.phase = pp.value;
      q = q.replace(pp.pattern, "");
    }
  }

  const btuShorthand = q.match(/\b(\d{1,3})\s*k\b/i);
  if (btuShorthand && currentFilters.btu === "__all__") {
    const kVal = parseInt(btuShorthand[1], 10);
    const validBuckets = [9, 12, 18, 24, 34, 36, 48, 60, 76];
    if (validBuckets.includes(kVal)) {
      autoFilters.btu = kVal >= 76 ? "76K+" : `${kVal}K`;
      q = q.replace(btuShorthand[0], "");
    }
  }

  if (!autoFilters.btu) {
    for (const bp of BTU_PREPROCESS_PATTERNS) {
      if (bp.pattern.test(q) && currentFilters.btu === "__all__") {
        autoFilters.btu = bp.bucket;
        q = q.replace(bp.pattern, "");
        break;
      }
    }
  }

  return { cleanedQuery: q.replace(/\s+/g, " ").trim(), autoFilters, autoSort };
}

// ── Fuse.js helpers ─────────────────────────────────────
export const FUSE_SCORE_THRESHOLD = 0.42;

export const FUSE_OPTIONS = {
  keys: [
    { name: "search_blob", weight: 1 },
    { name: "product_code", weight: 0.9 },
    { name: "short_name", weight: 0.8 },
    { name: "description", weight: 0.7 },
    { name: "category", weight: 0.4 },
  ],
  threshold: 0.45,
  distance: 200,
  includeScore: true,
  useExtendedSearch: false,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function fuseMultiTokenSearch<T extends SearchableProduct>(items: T[], fuse: Fuse<T>, query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const tokenResults = tokens.map((token) => {
    const results = fuse.search(token);
    const good = results.filter(r => (r.score ?? 1) <= FUSE_SCORE_THRESHOLD);
    return new Map(good.map((r) => [r.item.id, r.score ?? 1]));
  });

  const firstSet = tokenResults[0];
  const andMatches: { id: string; combinedScore: number }[] = [];

  firstSet.forEach((score, id) => {
    let totalScore = score;
    let matchAll = true;
    for (let i = 1; i < tokenResults.length; i++) {
      const s = tokenResults[i].get(id);
      if (s === undefined) { matchAll = false; break; }
      totalScore += s;
    }
    if (matchAll) andMatches.push({ id, combinedScore: totalScore });
  });

  if (andMatches.length >= 3 || tokens.length <= 1) {
    andMatches.sort((a, b) => a.combinedScore - b.combinedScore);
    const itemMap = new Map(items.map((p) => [p.id, p]));
    return andMatches.map((m) => itemMap.get(m.id)!).filter(Boolean);
  }

  if (andMatches.length > 0) {
    andMatches.sort((a, b) => a.combinedScore - b.combinedScore);
    const itemMap = new Map(items.map((p) => [p.id, p]));
    return andMatches.map((m) => itemMap.get(m.id)!).filter(Boolean);
  }

  const scoreMap = new Map<string, { totalScore: number; tokenCount: number }>();
  tokenResults.forEach((results) => {
    results.forEach((score, id) => {
      const existing = scoreMap.get(id);
      if (existing) {
        existing.totalScore += score;
        existing.tokenCount += 1;
      } else {
        scoreMap.set(id, { totalScore: score, tokenCount: 1 });
      }
    });
  });

  const orMatches = Array.from(scoreMap.entries())
    .map(([id, { totalScore, tokenCount }]) => ({
      id,
      rank: -tokenCount * 1000 + totalScore,
    }))
    .sort((a, b) => a.rank - b.rank);

  const itemMap = new Map(items.map((p) => [p.id, p]));
  return orMatches.map((m) => itemMap.get(m.id)!).filter(Boolean);
}

// ── Unit type priority sorting ──────────────────────────
const UNIT_TYPE_PRIORITY: Record<string, number> = {
  "Midwall": 1,
  "Cassette": 2,
  "Ducted": 3,
  "Large Ducted": 3,
  "Under Ceiling": 4,
  "Floor Standing": 5,
  "Rooftop Package": 5,
  "Portable": 5,
  "Window Wall": 5,
  "Air Cooled Chiller": 5,
  "Accessories": 5,
};

/** Map a category string to a unit-type priority bucket */
export function getCategoryPriority(category: string | null): number {
  if (!category) return 99;
  const cat = category.toLowerCase();
  // Check each known type
  if (cat.includes("midwall") || cat.includes("high wall") || cat.includes("wall-mounted") || cat.includes("breezeless")) return 1;
  if (cat.includes("cassette")) return 2;
  if (cat.includes("ducted") || cat.includes("hide away")) return 3;
  if (cat.includes("under ceiling")) return 4;
  // Everything else
  return 5;
}

export function sortByUnitTypePriority<T extends { category: string | null; description: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = getCategoryPriority(a.category);
    const pb = getCategoryPriority(b.category);
    if (pa !== pb) return pa - pb;
    return (a.description || "").localeCompare(b.description || "");
  });
}

/** Sort category strings by unit-type priority */
export function sortCategoriesByPriority(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const pa = getCategoryPriority(a);
    const pb = getCategoryPriority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}
