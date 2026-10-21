import { describe, it, expect } from "vitest";
import { r0QuoteOffenders, r0FormOffenders, blockR0Quote } from "@/lib/zeroPriceGuard";
import { r0Summary, clearR0Line, r0PriceInput } from "@/lib/r0Highlight";

describe("R0 highlight", () => {
  const lines = [
    { id: "a", area_id: "l", item_name: "Samsung 12K", quantity: 1, unit_price: 6000 },
    { id: "b", area_id: "l", item_name: "Bracket", quantity: 1, unit_price: 0 },
    { id: "c", area_id: "k", item_name: "Copper", quantity: 0, unit_price: 0, metadata: { qty_unit: "metre" } },
    { id: "d", area_id: "k", item_name: "Labour", item_type: "labour", quantity: 2, unit_price: 0 },
    { id: "e", area_id: null, item_name: "Heading", quantity: 0, unit_price: 0 },
  ];
  it("lists every offender with area + reason, same rule as r0Quote", () => {
    const o = r0QuoteOffenders(lines as any, { l: "Lounge", k: "Kitchen" });
    expect(o.map((x) => [x.key, x.areaKey, x.reason])).toEqual([["b", "l", "price"], ["c", "k", "metres"]]);
    expect(r0Summary(o)).toBe("Lounge: Bracket · Kitchen: Copper");
  });
  it("blocks with a count toast and clears per line", () => {
    const toasts: any[] = [];
    expect(blockR0Quote(lines as any, (t) => toasts.push(t), { l: "Lounge", k: "Kitchen" })).toBe(true);
    expect(toasts[0].title).toBe("2 prices missing");
    r0PriceInput("b", "0"); r0PriceInput("b", "120"); clearR0Line("c");
    expect(blockR0Quote([lines[0]] as any, (t) => toasts.push(t))).toBe(false);
  });
  it("form lines use room label", () => {
    expect(r0FormOffenders([{ description: "Gas", rate: 0, room_label: "Office" } as any, { description: "", rate: 0 }])).toEqual([{ key: "row:0", name: "Gas", areaKey: "room:Office", areaName: "Office", reason: "price" }]);
  });
});

import { markR0Quote, draftR0Toast } from "@/lib/zeroPriceGuard";
describe("R0 drafts", () => {
  it("draft marks + soft toast, never destructive", () => {
    const o = markR0Quote([{ id: "x", area_id: "l", item_name: "Bracket", quantity: 1, unit_price: 0 }] as any, { l: "Lounge" });
    const t: any[] = []; draftR0Toast(o, (x) => t.push(x));
    expect(t[0]).toMatchObject({ title: "Saved as draft — 1 price missing", variant: "default" });
    draftR0Toast([], (x) => t.push(x)); expect(t.length).toBe(1);
  });
});
