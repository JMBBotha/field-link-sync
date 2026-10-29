import { describe, it, expect } from "vitest";
import { groupNotifications } from "@/components/notifications/groupNotifications";
const n = (id: string, body: string, metadata: any = null) => ({ id, title: "t", body, created_at: new Date().toISOString(), read: false, metadata });
describe("groupNotifications", () => {
  it("stacks the same client by id or name, keeps others apart", () => {
    const g = groupNotifications([n("1", "Ric Meulemans: follow-up call"), n("2", "x", { customer_id: "c1", customer_name: "Ric Meulemans" }), n("3", "ric  meulemans · new lead"), n("4", "Marina vd Merwe: call"), n("5", "R 12 300 paid")]);
    expect(g.map((x) => x.items.length)).toEqual([3, 1, 1]);
    expect(g[0].label).toBe("Ric Meulemans");
  });
});
