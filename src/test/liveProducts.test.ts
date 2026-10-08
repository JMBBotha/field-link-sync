import { describe, it, expect, vi } from "vitest";

const from = vi.fn(() => ({ select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [{ id: "a" }] })) })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { liveProducts, filterLiveIds, LIVE_PRODUCTS_SOURCE } from "@/lib/liveProducts";

describe("liveProducts helper", () => {
  it("targets live_supplier_products", async () => {
    expect(LIVE_PRODUCTS_SOURCE).toBe("live_supplier_products");
    liveProducts();
    expect(from).toHaveBeenLastCalledWith("live_supplier_products");
    const live = await filterLiveIds(["a", "b"]);
    expect([...live]).toEqual(["a"]);
    expect(from).toHaveBeenLastCalledWith("live_supplier_products");
  });
});
