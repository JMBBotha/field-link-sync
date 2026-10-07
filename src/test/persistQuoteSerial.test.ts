import { describe, it, expect, vi } from "vitest";
import { mockSupabase } from "@/test/mocks/supabase";
import { runSerialPerQuote, persistQuoteFromBaskets } from "@/utils/persistQuoteFromBaskets";

describe("persistQuoteFromBaskets single-flight", () => {
  it("runs two concurrent calls for the same quote sequentially", async () => {
    const log: string[] = [];
    const job = (n: string) => async () => { log.push(`start ${n}`); await new Promise((r) => setTimeout(r, 10)); log.push(`end ${n}`); };
    await Promise.all([runSerialPerQuote("q1", job("a")), runSerialPerQuote("q1", job("b"))]);
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("continues after a failed call", async () => {
    const p1 = runSerialPerQuote("q2", async () => { throw new Error("x"); });
    const p2 = runSerialPerQuote("q2", async () => 5);
    await expect(p1).rejects.toThrow("x");
    await expect(p2).resolves.toBe(5);
  });

  it("uses the RPC and never inserts labour rows", async () => {
    const labour = { id: "l1", quote_id: "q3", area_id: "a-old", item_type: "labour", quantity: 3.5, unit_price: 680, total_price: 2380, metadata: { labour: true, hours: 3.5, rate: 680 } };
    const insert = vi.fn();
    const del = vi.fn();
    mockSupabase.from.mockImplementation(() => {
      const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b, insert, delete: del, update: () => b, then: (r: any) => r({ data: [labour], error: null }) };
      return b;
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    (mockSupabase as any).rpc = rpc;
    await persistQuoteFromBaskets("q3", []);
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe("replace_quote_from_builder");
    expect(args.p_items.some((i: any) => i.item_type === "labour")).toBe(false);
    expect(args.p_subtotal).toBeGreaterThan(0);
  });

  it("sends old_id for UUID basket ids so labour re-links survive renames", async () => {
    const uuidArea = "11111111-1111-4111-8111-111111111111";
    mockSupabase.from.mockImplementation(() => {
      const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b, then: (r: any) => r({ data: [], error: null }) };
      return b;
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    (mockSupabase as any).rpc = rpc;
    await persistQuoteFromBaskets("q4", [
      { id: uuidArea, name: "Living room", items: [] },
      { id: "basket-temp-1", name: "Kitchen", items: [] },
    ] as any);
    const args = rpc.mock.calls[0][1];
    const byName = Object.fromEntries(args.p_areas.map((a: any) => [a.name, a]));
    expect(byName["Living room"].old_id).toBe(uuidArea);
    expect(byName["Kitchen"].old_id).toBeNull();
  });

  it("reconciles after the RPC: no temporary orphan inserts, and removes labour after the last unit", async () => {
    let savedAreas: any[] = [];
    let savedLabour: any[] = [];
    const writes: string[] = [];
    mockSupabase.from.mockImplementation((table: string) => {
      let action = "read", payload: any, id: string | undefined;
      const b: any = {
        select: () => b, order: () => b, limit: () => b,
        eq: (key: string, value: string) => { if (key === "id") id = value; return b; },
        insert: (p: any) => { action = "insert"; payload = p; return b; },
        update: (p: any) => { action = "update"; payload = p; return b; },
        delete: () => { action = "delete"; return b; },
        then: (resolve: any) => {
          if (table === "quote_items" && action !== "read") {
            writes.push(action);
            if (action === "insert") {
              expect(savedAreas.some((a) => a.id === payload.area_id)).toBe(true);
              savedLabour.push(payload);
            } else if (action === "update") Object.assign(savedLabour.find((r) => r.id === id), payload);
            else savedLabour = savedLabour.filter((r) => r.id !== id);
            return resolve({ data: [{ id: id ?? payload.id }], error: null });
          }
          const data = table === "quote_items" ? savedLabour : table === "quote_areas" ? savedAreas : table === "company_settings" ? [{ default_install_labour_hours: 3.5, default_hourly_rate: 680 }] : [{ labour_mode: "per_area" }];
          resolve({ data: structuredClone(data), error: null });
        },
      };
      return b;
    });
    (mockSupabase as any).rpc = vi.fn(async (_name, args) => {
      writes.push("rpc");
      savedLabour = savedLabour.map((l) => ({ ...l, area_id: args.p_areas.find((a: any) => a.old_id === l.area_id || savedAreas.find((old) => old.id === l.area_id)?.name === a.name)?.id ?? null }));
      savedAreas = args.p_areas;
      return { error: null };
    });
    const basket = (quantity: number) => [{ id: "local", name: "Bedroom", items: quantity ? [{ instanceId: "unit", quantity, product: { id: "p", short_name: "Samsung 12K INV MW", product_code: "AR40", product_category: "Air Conditioning", locked_sell_ex_vat: 10000, locked_cost_ex_vat: 8000 } }] : [] }] as any;
    const add = await persistQuoteFromBaskets("lifecycle", basket(1));
    expect(add.subtotal).toBe(12380);
    expect(savedLabour).toHaveLength(1);
    const originalId = savedLabour[0].id;
    const two = await persistQuoteFromBaskets("lifecycle", basket(2));
    expect(two.subtotal).toBe(24760);
    expect(savedLabour[0]).toMatchObject({ id: originalId, quantity: 7, total_price: 4760 });
    const remove = await persistQuoteFromBaskets("lifecycle", basket(0));
    expect(remove.subtotal).toBe(0);
    expect(savedLabour).toEqual([]);
    expect(writes).toEqual(["rpc", "insert", "rpc", "update", "rpc", "delete"]);
  });
});
