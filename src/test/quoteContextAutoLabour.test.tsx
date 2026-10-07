import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "@/test/mocks/supabase";
import { QuoteProvider, useQuoteContext } from "@/contexts/QuoteContext";
import { labourFields, isLabourItem } from "@/lib/labour";
import { computeQuoteTotals } from "@/utils/quoteTransformers";
import { buildClientRollup } from "@/lib/clientQuoteRollup";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "memory-user" } }) }));
vi.mock("@/hooks/useCompanySettings", () => ({ useCompanySettings: () => ({ settings: { default_install_labour_hours: 3.5, default_hourly_rate: 680 } }) }));
afterEach(cleanup);

describe("shared estimate / AreaFirst / PDF commit context labour", () => {
  it("reconciles add/remove/swap/two units and preserves manual overrides using only an in-memory backend", async () => {
    let stored: any[] = [];
    const area = { id: "bedroom", quote_id: "memory", name: "Bedroom", sort_order: 0 };
    mockSupabase.from.mockImplementation((table: string) => {
      let operation = "read", payload: any, id: string | undefined;
      const result = () => {
        if (table === "quote_items") {
          let affected: any[] = [];
          if (operation === "insert") { stored.push(structuredClone(payload)); affected = [payload]; }
          else if (operation === "update") { affected = stored.filter((r) => r.id === id).map((r) => Object.assign(r, payload)); }
          else if (operation === "delete") { affected = stored.filter((r) => r.id === id); stored = stored.filter((r) => r.id !== id); }
          return { data: structuredClone(operation === "read" ? stored : affected), error: null };
        }
        return { data: table === "quote_areas" ? [area] : [{ id: "memory", labour_mode: "per_area", customer_id: "customer", units_markup_percent: 25, materials_markup_percent: 100 }], error: null };
      };
      const b: any = {
        select: () => b, order: () => b,
        eq: (key: string, value: string) => { if (key === "id") id = value; return b; },
        insert: (p: any) => { operation = "insert"; payload = p; return b; },
        update: (p: any) => { operation = "update"; payload = p; return b; },
        delete: () => { operation = "delete"; return b; },
        single: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; },
        then: (resolve: any) => resolve(result()),
      };
      return b;
    });
    let ctx: ReturnType<typeof useQuoteContext>;
    function Probe() { ctx = useQuoteContext(); return null; }
    render(<QuoteProvider quoteId="memory"><Probe /></QuoteProvider>);
    await waitFor(() => expect(ctx.loading).toBe(false));
    const unit = (id: string, price = 10000) => ({ id, area_id: "bedroom", item_name: "Samsung 12K INV MW", item_type: "product", quantity: 1, unit_price: price, total_price: price, sort_order: 0, metadata: {} }) as any;
    const check = (expected: number, labourAmount: number) => {
      const l = ctx.items.filter(isLabourItem);
      expect(l.length).toBe(labourAmount ? 1 : 0);
      expect(l.reduce((s, r) => s + Number(r.total_price), 0)).toBe(labourAmount);
      for (const row of l) expect(row.total_price).toBe(Number(row.quantity) * Number(row.unit_price));
      expect(computeQuoteTotals(ctx.items, ctx.areas).subtotal).toBe(expected);
      expect(buildClientRollup(ctx.items, ctx.areas).reduce((s, a) => s + a.areaTotal, 0)).toBe(expected);
    };
    check(0, 0);
    await act(async () => { await ctx.addItem(unit("u1")); }); check(12380, 2380);
    // A legacy second callback must be harmless even with stale delta hours.
    await act(async () => { await ctx.addItem({ ...labourFields(7, 680, false, true), area_id: "bedroom", sort_order: 1 } as any); }); check(12380, 2380);
    await act(async () => { await ctx.deleteItem("u1"); }); check(0, 0);
    await act(async () => { await ctx.addItem(unit("replacement", 12000)); }); check(14380, 2380);
    await act(async () => { await ctx.addItem(unit("second")); }); check(26760, 4760);
    const labourId = ctx.items.find(isLabourItem)!.id;
    await act(async () => { await ctx.updateItem(labourId, labourFields(5, 800, true, false)); }); check(26000, 4000);
    await act(async () => { await ctx.deleteItem("replacement"); await ctx.deleteItem("second"); }); check(4000, 4000);
    expect(stored.filter(isLabourItem)).toHaveLength(1);
  });
});