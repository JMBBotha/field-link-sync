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
}

/** The 10 seeded core services, in order (must match the migration). */
export const CORE_SERVICE_NAMES = [
  "Removal of existing air conditioner",
  "Removal and reinstallation of existing air conditioner",
  "Installation of quoted air conditioner",
  "Repair of existing air conditioner or system",
  "Replacement of indoor or outdoor PC boards",
  "Isolator or electrical fault repair",
  "Service of ducted, cassette and under ceiling systems",
  "Service of split wall units",
  "Package unit",
  "Installation of under ceiling, cassette and hideaway systems",
] as const;

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

/**
 * Quote-line fields for a picked service. The description is COPIED onto the
 * line; editing the line never writes back to the catalogue. Price follows the
 * manual line behaviour (starts at R0, typed on the line).
 */
export function serviceLineFields(s: CatalogService) {
  return {
    item_name: s.name,
    description: s.description ?? null,
    item_type: "service" as const,
    unit_price: 0,
    quantity: 1,
    source: "service",
    metadata: { catalog_service_id: s.id, catalog_service_origin: s.origin },
  };
}

/** Mirror of the DB trigger: blocked when active custom count >= limit. */
export const customLimitBlocked = (activeCustomCount: number, limit: number | null | undefined) =>
  activeCustomCount >= (limit ?? 5);

export const isCustomLimitError = (e: { message?: string } | null | undefined) =>
  !!e?.message && e.message.includes("CUSTOM_LIMIT_REACHED");

/** Adapter for the voice/Mandy matcher (ServiceRow shape). No price: services are priced on the line. */
export const toServiceRow = (s: CatalogService) => ({
  id: s.id,
  name: s.name,
  category: s.origin === "custom" ? "Custom" : null,
  default_price: null as number | null,
  unit: null as string | null,
});
