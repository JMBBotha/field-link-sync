import { useState, useMemo, useEffect, useCallback, ReactNode, KeyboardEvent } from "react";
import Fuse from "fuse.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { offlineDb } from "@/lib/offlineDb";
import ProductDetailModal from "./ProductDetailModal";
import ProductSlideOverPanel from "./ProductSlideOverPanel";
import ProductCompareTable from "./ProductCompareTable";
import CatalogFilterBar, { CatalogFilters, DEFAULT_FILTERS, FilterCounts, SortOption } from "./CatalogFilterBar";
import CatalogSearchSuggestions, { FILTER_MATCHERS } from "./CatalogSearchSuggestions";
import {
  Package,
  TrendingUp,
  Plus,
  Loader2,
  WifiOff,
  Star,
  GitCompareArrows,
} from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

/** Highlight matching text segments */
function highlightText(text: string, query: string): ReactNode {
  if (!query.trim() || !text) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-accent/40 text-accent-foreground font-medium px-0.5 rounded">{part}</mark>
      : part
  );
}

interface SupplierProduct {
  id: string;
  supplier_id: string;
  supplier_name: string;
  product_code: string;
  description: string;
  category: string;
  subcategory: string | null;
  pipe_size: string | null;
  cost_price: number;
  default_markup_percent: number;
  selling_price: number;
  is_price_on_request: boolean;
  btu_rating: number | null;
  refrigerant_type: string | null;
  image_url: string | null;
  quote_usage_count: number;
  last_quoted_at: string | null;
  search_rank: number;
  short_name?: string | null;
  is_pinned?: boolean;
  pin_order?: number;
  rrp?: number | null;
  cost_excl_vat?: number | null;
  cost_incl_vat?: number | null;
}

interface ProductCatalogBrowserProps {
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
  supplierId?: string | null;
}

// ── Derived filter helpers ──────────────────────────────
function deriveSpeedType(p: SupplierProduct): string {
  const text = `${p.category} ${p.description} ${p.short_name || ""}`.toLowerCase();
  if (text.includes("inverter") || text.includes("inv ")) return "Inverter";
  if (text.includes("fixed speed") || text.includes("fs ")) return "Fixed Speed";
  return "";
}

function deriveUnitType(p: SupplierProduct): string {
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

function derivePhase(p: SupplierProduct): string {
  const text = `${p.product_code} ${p.description}`.toLowerCase();
  if (text.includes("3ph") || text.includes("three phase") || text.includes("3-phase")) return "3Ph";
  if (text.includes("1ph") || text.includes("single phase") || text.includes("1-phase")) return "1Ph";
  return "";
}

function deriveBrand(p: SupplierProduct): string {
  const code = (p.product_code || "").toUpperCase();
  const desc = (p.description || "").toLowerCase();
  if (code.startsWith("FOUR") || desc.includes("alliance")) return "Alliance";
  return "Midea";
}

function derivePipeSize(p: SupplierProduct): string {
  return (p.pipe_size || "").trim();
}

/** Build a synthetic search string with BTU variants and normalized brand for better Fuse.js matching */
function buildSearchBlob(p: SupplierProduct): string {
  const parts = [p.product_code, p.short_name || "", p.description, p.category, p.subcategory || "", p.supplier_name, p.refrigerant_type || "", p.pipe_size || ""];
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

function deriveBtuBucket(p: SupplierProduct): string {
  const btu = p.btu_rating;
  if (!btu) return "";
  const k = btu / 1000;
  if (k >= 76) return "76K+";
  const buckets = [9, 12, 18, 24, 34, 36, 48, 60];
  const closest = buckets.reduce((prev, curr) => Math.abs(curr - k) < Math.abs(prev - k) ? curr : prev);
  return `${closest}K`;
}

function matchesFilters(p: SupplierProduct, f: CatalogFilters): boolean {
  if (f.speedType !== "__all__" && deriveSpeedType(p) !== f.speedType) return false;
  if (f.unitType !== "__all__" && deriveUnitType(p) !== f.unitType) return false;
  if (f.btu !== "__all__" && deriveBtuBucket(p) !== f.btu) return false;
  if (f.refrigerant !== "__all__" && (p.refrigerant_type || "").toUpperCase() !== f.refrigerant.toUpperCase()) return false;
  if (f.phase !== "__all__" && derivePhase(p) !== f.phase) return false;
  if (f.brand !== "__all__" && deriveBrand(p) !== f.brand) return false;
  if (f.pipeSize !== "__all__" && derivePipeSize(p) !== f.pipeSize) return false;
  if (f.priceMin && p.selling_price < parseFloat(f.priceMin)) return false;
  if (f.priceMax && p.selling_price > parseFloat(f.priceMax)) return false;
  return true;
}

// ── Levenshtein distance for fuzzy brand matching ───────
const levenshteinDistance = (str1: string, str2: string): number => {
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

const KNOWN_BRANDS: { name: string; value: string }[] = [
  { name: "midea", value: "Midea" },
  { name: "alliance", value: "Alliance" },
  { name: "samsung", value: "Samsung" },
  { name: "daikin", value: "Daikin" },
  { name: "lg", value: "LG" },
];

// ── Smart query preprocessing ───────────────────────────
interface PreprocessedQuery {
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

function preprocessQuery(query: string, currentFilters: CatalogFilters): PreprocessedQuery {
  let q = query;
  const autoFilters: Partial<CatalogFilters> = {};
  let autoSort: SortOption | undefined;

  // Price keywords: "under R15000", "between R10000 and R20000", "cheapest"
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

  // Exact brand pattern matching
  for (const bp of BRAND_PATTERNS) {
    if (bp.pattern.test(q) && currentFilters.brand === "__all__") {
      autoFilters.brand = bp.value;
      q = q.replace(bp.pattern, "");
    }
  }

  // Fuzzy brand matching via Levenshtein (stricter: length diff <= 1 AND dist <= 2, OR dist <= 1)
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

  // Unit type detection (multi-word first, then single-word)
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

  // BTU shorthand: "24k", "12k", etc.
  const btuShorthand = q.match(/\b(\d{1,3})\s*k\b/i);
  if (btuShorthand && currentFilters.btu === "__all__") {
    const kVal = parseInt(btuShorthand[1], 10);
    const validBuckets = [9, 12, 18, 24, 34, 36, 48, 60, 76];
    if (validBuckets.includes(kVal)) {
      autoFilters.btu = kVal >= 76 ? "76K+" : `${kVal}K`;
      q = q.replace(btuShorthand[0], "");
    }
  }

  // BTU from full numbers like 24000
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

// ── Fuse.js multi-token search with AND→OR fallback + score filtering ─────
const FUSE_SCORE_THRESHOLD = 0.42;

function fuseMultiTokenSearch(items: SupplierProduct[], fuse: Fuse<SupplierProduct>, query: string): SupplierProduct[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const tokenResults = tokens.map((token) => {
    const results = fuse.search(token);
    // Filter out poor matches per token
    const good = results.filter(r => (r.score ?? 1) <= FUSE_SCORE_THRESHOLD);
    return new Map(good.map((r) => [r.item.id, r.score ?? 1]));
  });

  // Try strict AND first
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

  // If AND has enough results or single token, use AND
  if (andMatches.length >= 3 || tokens.length <= 1) {
    andMatches.sort((a, b) => a.combinedScore - b.combinedScore);
    const itemMap = new Map(items.map((p) => [p.id, p]));
    return andMatches.map((m) => itemMap.get(m.id)!).filter(Boolean);
  }

  // If AND still has some results, return them (better than noisy OR)
  if (andMatches.length > 0) {
    andMatches.sort((a, b) => a.combinedScore - b.combinedScore);
    const itemMap = new Map(items.map((p) => [p.id, p]));
    return andMatches.map((m) => itemMap.get(m.id)!).filter(Boolean);
  }

  // Fallback to OR with token-count weighting
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

// ── Auto-generate short name from product data ──────────
function generateShortName(p: SupplierProduct): string {
  const brand = deriveBrand(p).toUpperCase();
  const btu = p.btu_rating ? `${Math.round(p.btu_rating / 1000)}K` : "";
  const speed = deriveSpeedType(p);
  const speedAbbr = speed === "Inverter" ? "INV" : speed === "Fixed Speed" ? "FS" : "";
  const unit = deriveUnitType(p);
  const unitAbbr = unit ? unit.toUpperCase().slice(0, 3) : "";
  const parts = [brand, btu, speedAbbr, unitAbbr].filter(Boolean);
  return parts.join(" ") || p.product_code;
}

// ── Component ───────────────────────────────────────────
const ProductCatalogBrowser = ({ onAddToQuote, supplierId }: ProductCatalogBrowserProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("pinned");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showArchived, setShowArchived] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null);
  const [filters, setFilters] = useState<CatalogFilters>({ ...DEFAULT_FILTERS });
  const [panelProductId, setPanelProductId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("hvacSearchHistory");
      return saved ? JSON.parse(saved).slice(0, 10) : [];
    } catch { return []; }
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const addToHistory = useCallback((term: string) => {
    const t = term.trim();
    if (!t || t.length < 2) return;
    setSearchHistory(prev => {
      const deduped = [t, ...prev.filter(h => h.toLowerCase() !== t.toLowerCase())].slice(0, 10);
      try { localStorage.setItem("hvacSearchHistory", JSON.stringify(deduped)); } catch {}
      return deduped;
    });
  }, []);

  const removeFromHistory = useCallback((term: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h !== term);
      try { localStorage.setItem("hvacSearchHistory", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  useEffect(() => {
    const handler = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    setIsOffline(!navigator.onLine);
    return () => { window.removeEventListener("online", handler); window.removeEventListener("offline", handler); };
  }, []);

  const { data: allProducts = [], isLoading } = useQuery({
    queryKey: ["supplier-products-all", supplierId, showArchived],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc("search_supplier_products", {
          p_query: null, p_category: null, p_supplier_id: supplierId || null, p_limit: 2000, p_include_archived: showArchived,
        });
        if (error) throw error;
        const results = (data || []) as SupplierProduct[];
        if (results.length > 0) {
          offlineDb.cacheCatalogProducts(results.map(p => ({
            id: p.id, supplier_id: p.supplier_id, supplier_name: p.supplier_name,
            product_code: p.product_code, description: p.description, category: p.category,
            pipe_size: p.pipe_size, cost_price: p.cost_price, selling_price: p.selling_price,
            is_price_on_request: p.is_price_on_request, btu_rating: p.btu_rating,
            refrigerant_type: p.refrigerant_type, quote_usage_count: p.quote_usage_count,
            default_markup_percent: p.default_markup_percent,
          }))).catch(() => {});
        }
        return results;
      } catch {
        const cached = await offlineDb.getCachedCatalogProducts();
        if (cached.length > 0) {
          setIsOffline(true);
          return cached.map(c => ({ ...c, subcategory: null, image_url: null, last_quoted_at: null, search_rank: 0 })) as SupplierProduct[];
        }
        return [];
      }
    },
    staleTime: 60000,
  });

  // Derive available brands from data
  const availableBrands = useMemo(() => {
    const brands = new Set<string>();
    allProducts.forEach((p) => {
      const b = deriveBrand(p);
      if (b) brands.add(b);
    });
    return [...brands];
  }, [allProducts]);

  // Derive available pipe sizes
  const availablePipeSizes = useMemo(() => {
    const sizes = new Set<string>();
    allProducts.forEach((p) => {
      const ps = derivePipeSize(p);
      if (ps) sizes.add(ps);
    });
    return [...sizes].sort();
  }, [allProducts]);

  // Build enriched items for Fuse with a searchBlob field
  const enrichedProducts = useMemo(() =>
    allProducts.map(p => ({ ...p, _searchBlob: buildSearchBlob(p) })),
    [allProducts]
  );

  const fuse = useMemo(
    () => new Fuse(enrichedProducts, {
      keys: [
        { name: "product_code", weight: 2 },
        { name: "short_name", weight: 2 },
        { name: "_searchBlob", weight: 1.5 },
        { name: "description", weight: 1.5 },
        { name: "category", weight: 1 },
        { name: "supplier_name", weight: 1 },
        { name: "subcategory", weight: 0.8 },
        { name: "pipe_size", weight: 0.5 },
        { name: "refrigerant_type", weight: 0.5 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2,
    }),
    [enrichedProducts]
  );

  // Smart preprocessing: extract filter terms from search query
  const preprocessed = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return preprocessQuery(searchQuery, filters);
  }, [searchQuery, filters]);

  // Auto-apply extracted filters (debounced via effect)
  useEffect(() => {
    if (!preprocessed) return;
    const { autoFilters, autoSort } = preprocessed;
    if (Object.keys(autoFilters).length === 0 && !autoSort) return;
    // Only apply once per query change - check if filters differ
    let shouldUpdate = false;
    const newFilters = { ...filters };
    for (const [key, value] of Object.entries(autoFilters)) {
      if (filters[key as keyof CatalogFilters] !== value) {
        (newFilters as any)[key] = value;
        shouldUpdate = true;
      }
    }
    if (shouldUpdate) setFilters(newFilters);
    if (autoSort && sortBy !== autoSort) setSortBy(autoSort);
    // Update the search query to the cleaned version
    if (preprocessed.cleanedQuery !== searchQuery.trim()) {
      setSearchQuery(preprocessed.cleanedQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preprocessed?.cleanedQuery]);

  // Apply search + structured filters with AND→OR logic
  const filtered = useMemo(() => {
    let results: SupplierProduct[];
    const effectiveQuery = searchQuery.trim();
    if (effectiveQuery.length > 0) {
      results = fuseMultiTokenSearch(enrichedProducts, fuse, effectiveQuery);
    } else {
      results = [...allProducts];
    }
    // Apply structured filters
    results = results.filter((p) => matchesFilters(p, filters));
    return results;
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters]);

  // Compute dynamic filter counts: for each filter dimension, count products matching ALL OTHER active filters + search
  const filterCounts = useMemo<FilterCounts>(() => {
    // Base set: search-filtered products (before structured filters)
    let baseResults: SupplierProduct[];
    const effectiveQuery = searchQuery.trim();
    if (effectiveQuery.length > 0) {
      baseResults = fuseMultiTokenSearch(enrichedProducts, fuse, effectiveQuery);
    } else {
      baseResults = allProducts;
    }

    const countFor = (dimension: keyof CatalogFilters) => {
      const otherFilters = { ...filters, [dimension]: "__all__" };
      const pool = baseResults.filter(p => matchesFilters(p, otherFilters));
      const counts: Record<string, number> = {};
      for (const p of pool) {
        let val = "";
        switch (dimension) {
          case "speedType": val = deriveSpeedType(p); break;
          case "unitType": val = deriveUnitType(p); break;
          case "btu": val = deriveBtuBucket(p); break;
          case "refrigerant": val = (p.refrigerant_type || "").toUpperCase(); break;
          case "phase": val = derivePhase(p); break;
          case "brand": val = deriveBrand(p); break;
          case "pipeSize": val = derivePipeSize(p); break;
        }
        if (val) counts[val] = (counts[val] || 0) + 1;
      }
      return counts;
    };

    return {
      speedType: countFor("speedType"),
      unitType: countFor("unitType"),
      btu: countFor("btu"),
      refrigerant: countFor("refrigerant"),
      phase: countFor("phase"),
      brand: countFor("brand"),
      pipeSize: countFor("pipeSize"),
    };
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const pinnedSort = (a: SupplierProduct, b: SupplierProduct) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      if (aPinned && bPinned) return ((a.pin_order || 0) - (b.pin_order || 0));
      return 0;
    };
    switch (sortBy) {
      case "price_asc": return arr.sort((a, b) => pinnedSort(a, b) || a.selling_price - b.selling_price);
      case "price_desc": return arr.sort((a, b) => pinnedSort(a, b) || b.selling_price - a.selling_price);
      case "btu_asc": return arr.sort((a, b) => pinnedSort(a, b) || (a.btu_rating || 0) - (b.btu_rating || 0));
      case "btu_desc": return arr.sort((a, b) => pinnedSort(a, b) || (b.btu_rating || 0) - (a.btu_rating || 0));
      case "name": return arr.sort((a, b) => pinnedSort(a, b) || a.description.localeCompare(b.description));
      case "pinned":
      default: return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
    }
  }, [filtered, sortBy]);

  const pinnedCount = useMemo(() => filtered.filter(p => p.is_pinned).length, [filtered]);

  const unarchiveMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ archived: false, archived_at: null } as any).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }); toast({ title: "Product unarchived" }); },
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ productId, isPinned }: { productId: string; isPinned: boolean }) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ is_pinned: !isPinned, pin_order: isPinned ? 0 : Date.now() } as any).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
  });

  const incrementUsageMutation = useMutation({
    mutationFn: async (productId: string) => { await supabase.rpc("increment_product_usage", { p_product_id: productId }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
  });

  const handleAddToQuote = (product: SupplierProduct) => {
    if (onAddToQuote) {
      onAddToQuote({ description: `${product.product_code} - ${product.description}`, quantity: 1, unit_price: product.selling_price });
      incrementUsageMutation.mutate(product.id);
      toast({ title: "Added to quote", description: product.product_code });
    }
  };

  // ── Slide-over panel helpers ──
  const panelProduct = useMemo(() => panelProductId ? sorted.find(p => p.id === panelProductId) || null : null, [panelProductId, sorted]);
  const panelIndex = useMemo(() => panelProductId ? sorted.findIndex(p => p.id === panelProductId) : -1, [panelProductId, sorted]);

  const openPanel = useCallback((product: SupplierProduct) => {
    setPanelProductId(product.id);
    setPanelOpen(true);
  }, []);

  const navigatePanel = useCallback((dir: 1 | -1) => {
    const newIdx = panelIndex + dir;
    if (newIdx >= 0 && newIdx < sorted.length) {
      setPanelProductId(sorted[newIdx].id);
    }
  }, [panelIndex, sorted]);

  // ── Compare helpers ──
  const toggleCompare = useCallback((productId: string) => {
    setCompareIds(prev => {
      if (prev.includes(productId)) return prev.filter(id => id !== productId);
      if (prev.length >= 4) { toast({ title: "Compare limit", description: "Maximum 4 products" }); return prev; }
      return [...prev, productId];
    });
  }, [toast]);

  const compareProducts = useMemo(() => compareIds.map(id => allProducts.find(p => p.id === id)).filter(Boolean) as SupplierProduct[], [compareIds, allProducts]);

  const handleSuggestionFilter = useCallback((action: string, removePattern: RegExp) => {
    const [key, value] = action.split(":");
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSearchQuery(prev => prev.replace(removePattern, "").trim());
    setShowSuggestions(false);
  }, []);

  // Count total suggestions for keyboard nav
  const suggestionCount = useMemo(() => {
    if (!searchQuery.trim() && showSuggestions) return Math.min(searchHistory.length, 8);
    if (!searchQuery.trim() || !showSuggestions) return 0;
    let count = 0;
    const seenActions = new Set<string>();
    for (const m of FILTER_MATCHERS) {
      if (m.pattern.test(searchQuery) && !seenActions.has(m.action)) { seenActions.add(m.action); count++; }
    }
    count += Math.min(sorted.length, 5);
    return Math.min(count, 10);
  }, [searchQuery, showSuggestions, searchHistory.length, sorted.length]);

  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIndex(-1); return; }
    if (!showSuggestions || suggestionCount === 0) {
      if (e.key === "Enter" && searchQuery.trim()) { addToHistory(searchQuery); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIndex(prev => (prev + 1) % suggestionCount); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIndex(prev => (prev - 1 + suggestionCount) % suggestionCount); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestionIndex < 0) { addToHistory(searchQuery); setShowSuggestions(false); return; }
      // Determine what's at this index
      if (!searchQuery.trim()) {
        // History mode
        const h = searchHistory[suggestionIndex];
        if (h) { setSearchQuery(h); setShowSuggestions(false); setSuggestionIndex(-1); }
        return;
      }
      // Filter + product mode
      let idx = 0;
      const seenActions = new Set<string>();
      for (const m of FILTER_MATCHERS) {
        if (m.pattern.test(searchQuery) && !seenActions.has(m.action)) {
          seenActions.add(m.action);
          if (idx === suggestionIndex) { handleSuggestionFilter(m.action, m.removePattern); setSuggestionIndex(-1); return; }
          idx++;
        }
      }
      const topProducts = sorted.slice(0, 5);
      for (const p of topProducts) {
        if (idx === suggestionIndex) { setSelectedProduct(p); setShowSuggestions(false); setSuggestionIndex(-1); return; }
        idx++;
      }
    }
  }, [showSuggestions, suggestionCount, suggestionIndex, searchQuery, searchHistory, sorted, handleSuggestionFilter, addToHistory]);

  return (
    <div className="space-y-3">
      {isOffline && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg px-3 py-2 text-xs">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> Browsing offline cache
        </div>
      )}

      {/* Sticky filter bar with integrated search + sort */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm pb-2 -mx-1 px-1">
        <CatalogFilterBar
          filters={filters}
          onChange={setFilters}
          availableBrands={availableBrands}
          availablePipeSizes={availablePipeSizes}
          totalCount={allProducts.length}
          filteredCount={sorted.length}
          counts={filterCounts}
          searchQuery={searchQuery}
          onSearchChange={(q) => { setSearchQuery(q); setShowSuggestions(true); setSuggestionIndex(-1); }}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onSearchFocus={() => setShowSuggestions(true)}
          onSearchKeyDown={handleSearchKeyDown}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          searchSuggestions={
            <CatalogSearchSuggestions
              query={searchQuery}
              products={sorted}
              visible={showSuggestions && (searchQuery.trim().length > 0 || searchHistory.length > 0)}
              onSelectFilter={handleSuggestionFilter}
              onSelectProduct={(id) => { const p = allProducts.find(x => x.id === id); if (p) setSelectedProduct(p); setShowSuggestions(false); }}
              onClose={() => { setShowSuggestions(false); setSuggestionIndex(-1); }}
              focusIndex={suggestionIndex}
              searchHistory={searchHistory}
              onSelectHistory={(term) => { setSearchQuery(term); setShowSuggestions(false); setSuggestionIndex(-1); }}
              onRemoveHistory={removeFromHistory}
            />
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isLoading ? "Loading products..." : `${sorted.length} products found`}
          {pinnedCount > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" /> {pinnedCount} pinned
            </Badge>
          )}
          {compareIds.length > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5">
              <GitCompareArrows className="h-2.5 w-2.5" /> {compareIds.length} selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Show Archived</Label>
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {searchQuery.trim() ? `No products match "${searchQuery}". Try fewer keywords or check spelling.` : "No products found. Import a price list to get started."}
          </p>
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-1">
          {/* List header */}
          <div className="grid grid-cols-[24px_1fr_2fr_80px_60px_80px_100px_40px] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
            <span></span><span>Model</span><span>Description</span><span>BTU</span><span>Refrig.</span><span>Pipe</span><span className="text-right">Price</span><span></span>
          </div>
          {sorted.map((product) => {
            const isPinned = !!product.is_pinned;
            const isCompared = compareIds.includes(product.id);
            return (
              <div
                key={product.id}
                className={`grid grid-cols-[24px_1fr_2fr_80px_60px_80px_100px_40px] gap-2 items-center px-3 py-2 rounded-md border cursor-pointer hover:bg-accent/30 transition-colors ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""} ${isCompared ? "ring-1 ring-accent" : ""}`}
                onClick={() => openPanel(product)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isCompared} onCheckedChange={() => toggleCompare(product.id)} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono font-medium truncate">{highlightText(product.product_code, searchQuery)}</p>
                  <p className="text-[10px] text-primary font-semibold truncate">{highlightText(product.short_name || generateShortName(product), searchQuery)}</p>
                </div>
                <p className="text-xs text-muted-foreground truncate">{highlightText(product.description, searchQuery)}</p>
                <span className="text-xs text-muted-foreground">{product.btu_rating ? `${(product.btu_rating / 1000).toFixed(0)}K` : "—"}</span>
                <span className="text-xs text-muted-foreground">{product.refrigerant_type || "—"}</span>
                <span className="text-xs text-muted-foreground">{product.pipe_size || "—"}</span>
                <span className="text-xs font-bold text-right">
                  {product.is_price_on_request || (!product.selling_price && !product.cost_price)
                    ? <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600 bg-amber-500/10 font-semibold px-1">POR</Badge>
                    : <span className="text-primary">{formatZAR(product.selling_price)}</span>}
                </span>
                <div className="flex items-center justify-end">
                  <Button
                    size="icon" variant="ghost"
                    className={`h-6 w-6 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                    onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                  >
                    <Star className={`h-3 w-3 ${isPinned ? "fill-current" : ""}`} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((product) => {
            const isPinned = !!product.is_pinned;
            const isCompared = compareIds.includes(product.id);
            return (
              <Card
                key={product.id}
                className={`hover:shadow-md transition-shadow active:scale-[0.99] cursor-pointer ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""} ${isCompared ? "ring-1 ring-accent" : ""}`}
                onClick={() => openPanel(product)}
              >
                <CardContent className={isMobile ? "p-3" : "p-4"}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                        <Checkbox checked={isCompared} onCheckedChange={() => toggleCompare(product.id)} className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-primary ${isMobile ? "text-sm" : "text-base"} ${(product as any).archived ? "line-through" : ""}`}>
                          {highlightText(product.short_name || generateShortName(product), searchQuery)}
                        </p>
                        <p className={`text-xs font-mono text-muted-foreground ${(product as any).archived ? "line-through" : ""}`}>{highlightText(product.product_code, searchQuery)}</p>
                        <p className={`mt-0.5 line-clamp-2 text-muted-foreground ${isMobile ? "text-[11px]" : "text-xs"} ${(product as any).archived ? "line-through" : ""}`}>{highlightText(product.description, searchQuery)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isPinned && (
                        <Badge variant="secondary" className="text-[10px] px-1">
                          <Star className="h-2.5 w-2.5 fill-current text-amber-500" />
                        </Badge>
                      )}
                      {product.quote_usage_count > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          <TrendingUp className="h-3 w-3 mr-0.5" />{product.quote_usage_count}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-2">
                    {(product as any).archived && <Badge variant="destructive" className="text-[10px]">Archived</Badge>}
                    <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                    {product.btu_rating && <Badge variant="outline" className="text-[10px]">{(product.btu_rating / 1000).toFixed(0)}K BTU</Badge>}
                    {product.refrigerant_type && <Badge variant="outline" className="text-[10px]">{product.refrigerant_type}</Badge>}
                    {product.pipe_size && <Badge variant="outline" className="text-[10px]">⌀ {product.pipe_size}</Badge>}
                  </div>

                  <Separator className="mb-2" />

                  <div className="flex items-end justify-between">
                    <div>
                      {product.is_price_on_request || (!product.selling_price && !product.cost_price) ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 bg-amber-500/10 font-semibold">POR</Badge>
                      ) : (
                        <>
                          <p className="text-[10px] text-muted-foreground">Cost: {formatZAR(product.cost_price)}</p>
                          {product.rrp && product.rrp > product.selling_price && (
                            <p className="text-[10px] text-muted-foreground line-through">{formatZAR(product.rrp)}</p>
                          )}
                          <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon" variant="ghost"
                        className={`h-7 w-7 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                        onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                      >
                        <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
                      </Button>
                      {(product as any).archived ? (
                        <Button size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); unarchiveMutation.mutate(product.id); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >Unarchive</Button>
                      ) : onAddToQuote && !product.is_price_on_request && (product.selling_price > 0 || product.cost_price > 0) ? (
                        <Button size="sm"
                          onClick={(e) => { e.stopPropagation(); handleAddToQuote(product); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating compare button */}
      {compareIds.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          <Button
            className="shadow-lg rounded-full px-6 gap-2"
            onClick={() => setCompareOpen(true)}
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare {compareIds.length} products
          </Button>
        </div>
      )}

      {/* Slide-over detail panel */}
      <ProductSlideOverPanel
        product={panelProduct}
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setTimeout(() => setPanelProductId(null), 300); }}
        onPrev={() => navigatePanel(-1)}
        onNext={() => navigatePanel(1)}
        hasPrev={panelIndex > 0}
        hasNext={panelIndex < sorted.length - 1}
        currentIndex={panelIndex}
        totalCount={sorted.length}
        deriveBrand={deriveBrand}
        deriveSpeedType={deriveSpeedType}
        derivePhase={derivePhase}
        onAddToQuote={onAddToQuote ? (item) => {
          onAddToQuote(item);
          if (panelProduct) incrementUsageMutation.mutate(panelProduct.id);
          toast({ title: "Added to quote" });
          setPanelOpen(false);
        } : undefined}
      />

      {/* Compare table */}
      <ProductCompareTable
        products={compareProducts}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onClear={() => setCompareIds([])}
        deriveBrand={deriveBrand}
        deriveSpeedType={deriveSpeedType}
        derivePhase={derivePhase}
      />

      {/* Legacy modal kept for suggestion clicks */}
      <ProductDetailModal
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(o) => !o && setSelectedProduct(null)}
        onAddToQuote={onAddToQuote ? (item) => {
          onAddToQuote(item);
          if (selectedProduct) incrementUsageMutation.mutate(selectedProduct.id);
          toast({ title: "Added to quote" });
          setSelectedProduct(null);
        } : undefined}
      />
    </div>
  );
};

export default ProductCatalogBrowser;
