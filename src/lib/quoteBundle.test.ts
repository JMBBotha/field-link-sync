import { describe, it, expect } from "vitest";
import { sendTogetherBlock, draftNeeds } from "./quoteBundle";

const L = (p: number, extra: Record<string, unknown> = {}) => ({ item_name: "Samsung 12k", quantity: 1, unit_price: p, parent_item_id: null, ...extra });

describe("draftNeeds", () => {
  it("ready draft needs nothing", () => expect(draftNeeds("c1", [L(100)])).toEqual([]));
  it("lists client, lines, prices", () => {
    expect(draftNeeds(null, [])).toEqual(["client", "lines"]);
    expect(draftNeeds("c1", [L(0), L(0), L(5)])).toEqual(["2 prices"]);
  });
  it("labour at R0 is not a missing price", () => expect(draftNeeds("c1", [L(9), L(0, { item_type: "labour", item_name: "Labour" })])).toEqual([]));
});

describe("sendTogetherBlock", () => {
  const ready = (id: string) => ({ id, status: "draft", customer_id: "c1", quote_number: id, needs: [] as string[] });
  it("allows ready drafts of one client", () => expect(sendTogetherBlock([ready("Q-1"), ready("Q-2"), { id: "Q-3", status: "sent", customer_id: "c1" }])).toBeNull());
  it("names what each draft needs", () =>
    expect(sendTogetherBlock([ready("Q-1"), { ...ready("Q-2"), needs: ["16 prices"] }])).toBe("Not ready: Q-2 needs 16 prices. Finish those, or send them one by one."));
  it("waits while drafts are checked", () => expect(sendTogetherBlock([ready("Q-1"), { ...ready("Q-2"), needs: undefined }])).toBe("Checking drafts…"));
  it("still needs one client", () => expect(sendTogetherBlock([ready("Q-1"), { ...ready("Q-2"), customer_id: "c2" }])).toBe("All quotes must be for the same client"));
});
