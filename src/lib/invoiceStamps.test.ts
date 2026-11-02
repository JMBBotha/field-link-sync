import { describe, it, expect } from "vitest";
import { invoiceStamps } from "./invoiceStamps";
const inv = { status: "sent", sent_at: "2026-10-20T09:00:00Z", grand_total: 46000, deposit_amount: 23000 };
const pay = (a: number, d: string, status = "paid") => ({ amount: a, payment_date: d, status });
describe("invoiceStamps", () => {
  it("mailed only", () => expect(invoiceStamps(inv, []).map((s) => s.kind)).toEqual(["mailed"]));
  it("mailed from sent_at even when sent externally", () => expect(invoiceStamps({ ...inv, sent_at: "2026-10-21" } as any, [])[0]).toMatchObject({ label: "MAILED", date: "2026-10-21" }));
  it("deposit paid date = payment reaching the deposit", () => {
    const s = invoiceStamps(inv, [pay(10000, "2026-10-22"), pay(13000, "2026-10-24")]);
    expect(s.map((x) => [x.kind, x.date])).toEqual([["mailed", "2026-10-20"], ["deposit", "2026-10-24"]]);
  });
  it("paid in full date = payment bringing balance to zero, keeps deposit", () => {
    const s = invoiceStamps(inv, [pay(23000, "2026-10-22"), pay(23000, "2026-11-01")]);
    expect(s.map((x) => [x.kind, x.date])).toEqual([["mailed", "2026-10-20"], ["deposit", "2026-10-22"], ["paid", "2026-11-01"]]);
  });
  it("one payment of everything: no separate deposit stamp", () => {
    expect(invoiceStamps(inv, [pay(46000, "2026-10-22")]).map((x) => x.kind)).toEqual(["mailed", "paid"]);
  });
  it("ignores unsettled payments and counts credit notes", () => {
    expect(invoiceStamps(inv, [pay(46000, "2026-10-22", "pending")]).map((x) => x.kind)).toEqual(["mailed"]);
    expect(invoiceStamps(inv, [pay(23000, "2026-10-22"), pay(13000, "2026-10-30")], 10000).map((x) => [x.kind, x.date])).toEqual([["mailed", "2026-10-20"], ["deposit", "2026-10-22"], ["paid", "2026-10-30"]]);
  });
  it("no stamps on void or draft", () => {
    expect(invoiceStamps({ ...inv, status: "void" }, [pay(46000, "2026-10-22")])).toEqual([]);
    expect(invoiceStamps({ ...inv, status: "draft" }, [])).toEqual([]);
  });
});
