import { describe, it, expect } from "vitest";
import { CORE_SERVICES, CORE_SERVICE_NAMES, orderServicesForPicker, serviceLineFields, customLimitBlocked, matchesService, type CatalogService } from "@/lib/catalogServices";

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

describe("custom limit rule", () => {
  it("limit 5 → the 6th insert is blocked", () => {
    let count = 0; const results: boolean[] = [];
    for (let i = 0; i < 6; i++) { const blocked = customLimitBlocked(count, 5); results.push(blocked); if (!blocked) count++; }
    expect(results).toEqual([false, false, false, false, false, true]);
    expect(customLimitBlocked(4, undefined)).toBe(false);
    expect(customLimitBlocked(5, null)).toBe(true);
  });
});
