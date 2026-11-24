import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CORE_SERVICES, CORE_SERVICE_NAMES, orderServicesForPicker, serviceLineFields, servicePriceEdited, servicePricePatch, customLimitBlocked, matchesService, BLUCHEM_SERVICE_NAME, BLUCHEM_DEFAULT_EXCL, BLUCHEM_SEARCH_TERMS, type CatalogService } from "@/lib/catalogServices";
import { invoiceTotals } from "@/lib/companyProfiles";

const svc = (o: Partial<CatalogService>): CatalogService => ({ id: "x", name: "x", description: "Description pending", sort_order: null, origin: "core", owner_company_id: "M", is_active: true, ...o });

describe("core service seed", () => {
  it("the 12 approved names + descriptions, exactly, in order", () => {
    expect(CORE_SERVICES.map((s) => ({ ...s }))).toEqual([
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
    ]);
    expect(CORE_SERVICE_NAMES).toHaveLength(12);
    expect(JSON.stringify(CORE_SERVICES)).not.toMatch(/compliance|Description pending/i);
  });
});

describe("picker ordering", () => {
  it("core by sort_order first, then own active custom; other companies hidden", () => {
    const out = orderServicesForPicker([
      svc({ id: "c1", name: "Zeta custom", origin: "custom", owner_company_id: "A" }),
      svc({ id: "k2", name: "B", sort_order: 2 }),
      svc({ id: "o", origin: "custom", owner_company_id: "OTHER" }),
      svc({ id: "k1", name: "A", sort_order: 1 }),
      svc({ id: "c0", name: "Alpha custom", origin: "custom", owner_company_id: "A" }),
      svc({ id: "off", origin: "custom", owner_company_id: "A", is_active: false }),
    ], "A");
    expect(out.map((s) => s.id)).toEqual(["k1", "k2", "c0", "c1"]);
  });
  it("keeps all 12 active core rows in sort order without a picker cap", () => {
    const rows = CORE_SERVICES.map((service, index) => svc({
      id: `core-${index + 1}`,
      name: service.name,
      description: service.description,
      sort_order: index + 1,
    })).reverse();
    const out = orderServicesForPicker(rows, "A");
    expect(out).toHaveLength(12);
    expect(out.map((service) => service.name)).toEqual(CORE_SERVICE_NAMES);
  });
  it("hideaway matches 'ducted'", () => {
    expect(matchesService(svc({ name: "Installation of under ceiling, cassette and hideaway systems", search_aliases: ["ducted"] }), "ducted")).toBe(true);
  });
});

describe("line description is a copy", () => {
  it("editing the line never mutates the catalogue row", () => {
    const row = svc({ id: "s", name: "Package unit", description: "Description pending" });
    const snapshot = JSON.stringify(row);
    const line = serviceLineFields(row);
    line.description = "Package unit — 10 kW rooftop";
    expect(JSON.stringify(row)).toBe(snapshot);
    expect(line).toMatchObject({ item_name: "Package unit", unit_price: 0, metadata: { catalog_service_id: "s" } });
  });
  it("blank-description core services create zero-price lines without placeholder text", () => {
    expect(serviceLineFields(svc({ name: "Extraction system", description: null }))).toMatchObject({
      item_name: "Extraction system",
      description: null,
      unit_price: 0,
      quantity: 1,
    });
  });
});

const BLUCHEM_DESC = "Bluchem BluGuard anti-corrosion coil coating applied to the outdoor unit. Protects against coastal salt-air corrosion; extended warranty applies when annual cleaning is recorded.";

describe("BluChem custom service", () => {
  const row = (): CatalogService => svc({
    id: "bluchem",
    name: BLUCHEM_SERVICE_NAME,
    description: BLUCHEM_DESC,
    origin: "custom",
    owner_company_id: "361bf031-9cdb-4d7f-9bde-9eb95fa4725e",
    default_unit_price: BLUCHEM_DEFAULT_EXCL,
    unit: "each",
    search_aliases: [...BLUCHEM_SEARCH_TERMS],
  });

  it("is found from each approved search", () => {
    const s = row();
    for (const term of BLUCHEM_SEARCH_TERMS) expect(matchesService(s, term)).toBe(true);
    expect(matchesService(s, "outdoor unit")).toBe(true);
  });

  it("copies R3,300 onto the quote line and leaves the catalogue row unchanged", () => {
    const s = row();
    const snapshot = JSON.stringify(s);
    const line = serviceLineFields(s);
    expect(line.unit_price).toBe(3300);
    expect(line.quantity).toBe(1);
    expect(line.description).toBe(BLUCHEM_DESC);
    expect(line.metadata).toMatchObject({ catalog_service_id: "bluchem", catalog_unit_price: 3300, service_unit: "each" });
    line.unit_price = 2800;
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(s.default_unit_price).toBe(3300);
  });

  it("an edited line price changes the line total and the 15% VAT base, and does not add a second discount", () => {
    const line = serviceLineFields(row());
    const patch = servicePricePatch({ quantity: 2, metadata: line.metadata }, 3000);
    expect(patch).toEqual({
      unit_price: 3000,
      total_price: 6000,
      metadata: { ...line.metadata, manual_price: true, price_overridden: true },
    });
    expect(patch).not.toHaveProperty("discount_type");
    expect(patch).not.toHaveProperty("discount_value");
    expect(servicePriceEdited(3000, patch.metadata)).toBe(true);
    expect(servicePriceEdited(3300, patch.metadata)).toBe(false);
    expect(servicePriceEdited(3000, line.metadata)).toBe(false);
    // One quote-level discount, then VAT at 15%. The edited sell price is not discounted again.
    const none = invoiceTotals([6000], null);
    expect(none).toMatchObject({ subtotal: 6000, discountAmount: 0, vat: 900, total: 6900 });
    const once = invoiceTotals([6000], { type: "percent", value: 10 });
    expect(once).toMatchObject({ discountAmount: 600, taxable: 5400, vat: 810, total: 6210 });
  });

  it("the go-live migration inserts one Massair row and does not touch supplier prices", () => {
    const sql = readFileSync("supabase/migrations/20261124190000_bluchem_custom_service.sql", "utf8");
    const rollback = readFileSync("supabase/manual/20261124190000_bluchem_custom_service_ROLLBACK.sql", "utf8");
    expect(sql).toContain("361bf031-9cdb-4d7f-9bde-9eb95fa4725e");
    expect(sql).toContain(BLUCHEM_SERVICE_NAME);
    expect(sql).toContain(BLUCHEM_DESC);
    expect(sql).toContain("3300");
    expect(sql).toContain("'each'");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).not.toMatch(/\b(update|insert|delete)\b[^;]*supplier_products/i);
    expect(rollback).toContain("DELETE FROM public.catalog_services");
    expect(rollback).not.toMatch(/\b(update|insert|delete)\b[^;]*supplier_products/i);
  });
});

describe("custom limit rule", () => {
  it("limit 5 → the 6th insert is blocked", () => {
    let count = 0; const results: boolean[] = [];
    for (let i = 0; i < 6; i++) { const blocked = customLimitBlocked(count, 5); results.push(blocked); if (!blocked) count++; }
    expect(results).toEqual([false, false, false, false, false, true]);
    expect(customLimitBlocked(4, undefined)).toBe(false);
    expect(customLimitBlocked(5, null)).toBe(true);
  });
});
