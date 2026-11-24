/** Master service catalogue (public.catalog_services) — pure helpers. */
export interface CatalogService {
  id: string;
  name: string;
  description: string | null;
  sort_order: number | null;
  origin: "core" | "custom";
  owner_company_id: string;
  is_active: boolean;
  search_aliases?: string[] | null;
  /** Catalogue sell price excl. VAT. Copied onto a new quote line; the line may be edited later. */
  default_unit_price?: number | null;
  /** Selling unit, e.g. "each". */
  unit?: string | null;
}

/** Approved Massair custom service. The row itself is inserted by the go-live migration. */
export const BLUCHEM_SERVICE_NAME = "BluChem anti-corrosion treatment (outdoor unit)";
export const BLUCHEM_DEFAULT_EXCL = 3300;

export const BLUCHEM_SEARCH_TERMS = [
  "bluchem",
  "blu chem",
  "bluguard",
  "anti-corrosion",
  "anticorrosion",
  "corrosion",
  "coastal",
  "coating",
] as const;

/** The 12 approved core services (name + master description), in sort_order 1..12. */
export const CORE_SERVICES = [
  { name: "Removal of existing air conditioner", description: "Safe disconnection and removal of the existing unit, with responsible refrigerant handling, leaving the area clean." },
  { name: "Removal and reinstallation of existing air conditioner", description: "Relocate the existing unit, including refrigerant recovery, new piping as needed, and commissioning." },
  { name: "Installation of quoted air conditioner", description: "Supply and install the unit on this quote, including mounting, piping, pressure test, vacuum, charge and commissioning." },
  { name: "Repair of existing air conditioner or system", description: "Diagnose and repair faults on an existing air conditioning system. Parts and labour are quoted as needed." },
  { name: "Replacement of indoor or outdoor PC boards", description: "Supply and fit a replacement indoor or outdoor PC board." },
  { name: "Isolator or electrical fault repair", description: "Find and repair electrical faults on the air conditioner supply, including the isolator, wiring and connections, with a safety test afterwards." },
  { name: "Ducted system", description: "Installation or service of ducted systems." },
  { name: "Service of split wall units", description: "Routine maintenance of split wall units to keep them clean, efficient and reliable, including cleaning, checks and a performance test." },
  { name: "Service of cassette and hideaway systems", description: "Routine maintenance of cassette and hideaway systems, including cleaning, checks and a performance test." },
  { name: "Package unit", description: "Installation or service of package units." },
  { name: "Extraction system", description: null },
  { name: "Fresh air system", description: null },
] as const;
export const CORE_SERVICE_NAMES = CORE_SERVICES.map((s) => s.name);

/** Picker order: active core by sort_order, then this company's active custom by name. */
export function orderServicesForPicker(rows: CatalogService[], companyId: string | null): CatalogService[] {
  const core = rows.filter((r) => r.is_active && r.origin === "core")
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
  const custom = rows.filter((r) => r.is_active && r.origin === "custom" && r.owner_company_id === companyId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...core, ...custom];
}

export function matchesService(s: CatalogService, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const blob = `${s.name} ${s.description ?? ""} ${(s.search_aliases ?? []).join(" ")}`.toLowerCase();
  return t.split(/\s+/).every((w) => blob.includes(w));
}

/** Catalogue default excl. VAT, or null when the service is priced on the line. */
export function catalogUnitPrice(s: Pick<CatalogService, "default_unit_price">): number | null {
  const n = Number(s.default_unit_price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Quote-line fields for a picked service. The description and the catalogue
 * price are COPIED onto the line. Editing the line never writes back to
 * catalog_services. A service with no catalogue price still starts at R0.
 */
export function serviceLineFields(s: CatalogService) {
  const catalog = catalogUnitPrice(s);
  return {
    item_name: s.name,
    description: s.description ?? null,
    item_type: "service" as const,
    unit_price: catalog ?? 0,
    quantity: 1,
    source: "service",
    metadata: {
      catalog_service_id: s.id,
      catalog_service_origin: s.origin,
      ...(catalog != null ? { catalog_unit_price: catalog } : {}),
      ...(s.unit ? { service_unit: s.unit } : {}),
    },
  };
}

/**
 * A typed price on a service line. Writes the quote line only: unit price,
 * line total, and an override flag. It does not set a discount and it does
 * not include the catalogue row.
 */
export function servicePricePatch(
  current: { quantity?: number | null; metadata?: Record<string, unknown> | null },
  nextPrice: number,
) {
  const price = Math.round((Number(nextPrice) || 0) * 100) / 100;
  const qty = Number(current.quantity) || 0;
  return {
    unit_price: price,
    total_price: Math.round(qty * price * 100) / 100,
    metadata: { ...(current.metadata || {}), manual_price: true, price_overridden: true },
  };
}

/** True when this quote line's price differs from the catalogue default copied onto it. */
export function servicePriceEdited(unitPrice: number, metadata?: { catalog_unit_price?: unknown; price_overridden?: unknown; manual_price?: unknown } | null): boolean {
  const catalog = Number(metadata?.catalog_unit_price);
  if (!Number.isFinite(catalog) || catalog <= 0) return false;
  if (!metadata?.price_overridden && !metadata?.manual_price) return false;
  return Math.round((Number(unitPrice) || 0) * 100) !== Math.round(catalog * 100);
}

/** Mirror of the DB trigger: blocked when active custom count >= limit. */
export const customLimitBlocked = (activeCustomCount: number, limit: number | null | undefined) =>
  activeCustomCount >= (limit ?? 5);

export const isCustomLimitError = (e: { message?: string } | null | undefined) =>
  !!e?.message && e.message.includes("CUSTOM_LIMIT_REACHED");

/** Adapter for the voice/Mandy matcher. The catalogue default is the starting price; a quote line can still be edited. */
export const toServiceRow = (s: CatalogService) => ({
  id: s.id,
  name: s.name,
  category: s.origin === "custom" ? "Custom" : null,
  default_price: catalogUnitPrice(s),
  unit: s.unit ?? null,
});
