import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { CORE_SERVICE_NAMES, orderServicesForPicker, serviceLineFields, customLimitBlocked, matchesService, type CatalogService } from "@/lib/catalogServices";

const svc = (o: Partial<CatalogService>): CatalogService => ({ id: "x", name: "x", description: "Description pending", sort_order: null, origin: "core", owner_company_id: "M", is_active: true, ...o });

describe("core service seed", () => {
  it("migration seeds exactly the 10 names in order", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir).map((f) => readFileSync(`${dir}/${f}`, "utf8")).find((t) => t.includes("CREATE TABLE public.catalog_services"))!;
    const seeded = [...sql.matchAll(/\('([^']+)', 'Description pending', (\d+), 'core'/g)].map((m) => [m[1], Number(m[2])]);
    expect(seeded.map((s) => s[0])).toEqual([...CORE_SERVICE_NAMES]);
    expect(seeded.map((s) => s[1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sql).toMatch(/-- Package unit: the unit type goes in the line description/);
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
