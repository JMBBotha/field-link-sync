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
      const b: any = { select: () => b, eq: () => b, insert, delete: del, update: () => b, then: (r: any) => r({ data: [labour], error: null }) };
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
      const b: any = { select: () => b, eq: () => b, then: (r: any) => r({ data: [], error: null }) };
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
});
