import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "@/test/mocks/supabase";
import { QuoteProvider, quoteSaveBlockedReason, useQuoteContext } from "@/contexts/QuoteContext";
import { readQuoteSnapshot, setQuoteSnapshotCacheEnabled } from "@/lib/quoteSnapshotCache";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "load-user" } }) }));
vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ settings: { default_install_labour_hours: 3.5, default_hourly_rate: 680 } }),
}));

afterEach(() => {
  cleanup();
  setQuoteSnapshotCacheEnabled(null);
});

describe("a failed quote load is not an empty quote", () => {
  it("retries, shows the error, refuses a write, and does not remember a blank snapshot", async () => {
    setQuoteSnapshotCacheEnabled(true);
    let failItems = true;
    let inserts = 0;
    const area = { id: "a1", quote_id: "q69", name: "Lounge", sort_order: 0 };
    const line = {
      id: "i1", quote_id: "q69", area_id: "a1", item_name: "Cassette", item_type: "product",
      quantity: 1, unit_price: 100, total_price: 100, sort_order: 0, parent_item_id: null, metadata: {},
    };
    mockSupabase.from.mockImplementation((table: string) => {
      const result = () => {
        if (table === "quote_items") {
          if (failItems) return { data: null, error: { message: "upstream timeout", code: "57014" } };
          return { data: [line], error: null };
        }
        if (table === "quote_areas") return { data: [area], error: null };
        if (table === "quotes") {
          return {
            data: { id: "q69", quote_number: "Q-2026-0069", status: "draft", total: 188272.99, labour_mode: "per_area", customer_id: "c" },
            error: null,
          };
        }
        return { data: [], error: null };
      };
      const b: any = {
        select: () => b,
        order: () => b,
        eq: () => b,
        insert: () => { inserts += 1; return b; },
        update: () => b,
        delete: () => b,
        single: async () => {
          const r = result();
          return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
        },
        then: (resolve: any) => resolve(result()),
      };
      return b;
    });

    let ctx: ReturnType<typeof useQuoteContext>;
    function Probe() { ctx = useQuoteContext(); return null; }
    render(<QuoteProvider quoteId="q69"><Probe /></QuoteProvider>);

    await waitFor(() => expect(ctx.error).toMatch(/timeout/));
    expect(ctx.loading).toBe(false);
    expect(ctx.serverReady).toBe(false);
    expect(ctx.items).toEqual([]);
    expect(ctx.areas).toEqual([]);
    expect(quoteSaveBlockedReason("q69")).toMatch(/didn't load/);
    expect(readQuoteSnapshot("q69")).toBeNull();

    await act(async () => {
      const added = await ctx.addItem({ item_name: "Should not save", quantity: 1, unit_price: 1, sort_order: 0 } as any);
      expect(added).toBeNull();
    });
    expect(inserts).toBe(0);
    expect(ctx.items).toEqual([]);

    failItems = false;
    await act(async () => { await ctx.refetch(); });
    await waitFor(() => expect(ctx.items.map((i) => i.item_name)).toEqual(["Cassette"]));
    expect(ctx.error).toBeNull();
    expect(ctx.serverReady).toBe(true);
    expect(quoteSaveBlockedReason("q69")).toBeNull();
    expect(readQuoteSnapshot<{ items: { item_name: string }[] }>("q69")?.items[0].item_name).toBe("Cassette");
  });
});
