import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offlineDb";

describe("Catalog Product Cache", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("caches and retrieves catalog products", async () => {
    await offlineDb.cacheCatalogProducts([
      {
        id: "prod-1",
        supplier_id: "sup-1",
        supplier_name: "Midea",
        product_code: "MSR-12",
        description: "Split Unit 12000BTU",
        category: "Split Units",
        pipe_size: "1/4 x 3/8",
        cost_price: 4500,
        selling_price: 6500,
        is_price_on_request: false,
        btu_rating: 12000,
        refrigerant_type: "R410A",
        quote_usage_count: 15,
        default_markup_percent: 35,
      },
      {
        id: "prod-2",
        supplier_id: "sup-1",
        supplier_name: "Midea",
        product_code: "MSR-24",
        description: "Split Unit 24000BTU",
        category: "Split Units",
        pipe_size: "3/8 x 5/8",
        cost_price: 8500,
        selling_price: 12000,
        is_price_on_request: false,
        btu_rating: 24000,
        refrigerant_type: "R410A",
        quote_usage_count: 8,
        default_markup_percent: 35,
      },
    ]);

    const all = await offlineDb.getCachedCatalogProducts();
    expect(all).toHaveLength(2);
    // Should be sorted by quote_usage_count desc
    expect(all[0].product_code).toBe("MSR-12");
  });

  it("filters by search query", async () => {
    await offlineDb.cacheCatalogProducts([
      {
        id: "p1",
        supplier_id: "s1",
        supplier_name: "Midea",
        product_code: "MSR-12",
        description: "Split Unit 12000BTU",
        category: "Split Units",
        pipe_size: null,
        cost_price: 4500,
        selling_price: 6500,
        is_price_on_request: false,
        btu_rating: 12000,
        refrigerant_type: null,
        quote_usage_count: 5,
        default_markup_percent: 30,
      },
      {
        id: "p2",
        supplier_id: "s1",
        supplier_name: "Midea",
        product_code: "CAS-36",
        description: "Cassette Unit 36000BTU",
        category: "Cassette Units",
        pipe_size: null,
        cost_price: 15000,
        selling_price: 22000,
        is_price_on_request: false,
        btu_rating: 36000,
        refrigerant_type: null,
        quote_usage_count: 2,
        default_markup_percent: 30,
      },
    ]);

    const results = await offlineDb.getCachedCatalogProducts("cassette");
    expect(results).toHaveLength(1);
    expect(results[0].product_code).toBe("CAS-36");
  });

  it("filters by category", async () => {
    await offlineDb.cacheCatalogProducts([
      {
        id: "p1",
        supplier_id: "s1",
        supplier_name: "A",
        product_code: "A1",
        description: "Desc",
        category: "Split Units",
        pipe_size: null,
        cost_price: 100,
        selling_price: 200,
        is_price_on_request: false,
        btu_rating: null,
        refrigerant_type: null,
        quote_usage_count: 0,
        default_markup_percent: 30,
      },
      {
        id: "p2",
        supplier_id: "s1",
        supplier_name: "A",
        product_code: "B1",
        description: "Desc2",
        category: "Ducted",
        pipe_size: null,
        cost_price: 200,
        selling_price: 400,
        is_price_on_request: false,
        btu_rating: null,
        refrigerant_type: null,
        quote_usage_count: 0,
        default_markup_percent: 30,
      },
    ]);

    const filtered = await offlineDb.getCachedCatalogProducts(undefined, "Ducted");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].category).toBe("Ducted");
  });
});
