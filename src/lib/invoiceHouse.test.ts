import { describe, it, expect } from "vitest";
import { parseHouseNo, invoiceHouseNo, matchesHouseSearch } from "./invoiceHouse";

describe("invoice house number", () => {
  it("parses common forms", () => {
    expect(parseHouseNo("HOUSE 88 - AVEC\n\nPO: X1")).toBe("88");
    expect(parseHouseNo("H32 double storey")).toBe("32");
    expect(parseHouseNo("Hse #7b")).toBe("7B");
    expect(parseHouseNo("Unit 12")).toBe("12");
    expect(parseHouseNo("Balance of 50% payable")).toBeNull();
  });
  it("prefers the project house link, then notes, then line items", () => {
    const map = new Map([["ph1", "32"]]);
    expect(invoiceHouseNo({ project_house_id: "ph1", notes: "HOUSE 88" }, map)).toBe("32");
    expect(invoiceHouseNo({ notes: "HOUSE 88 - Test" })).toBe("88");
    expect(invoiceHouseNo({ notes: null, line_items: [{ description: "HOUSE 5 - Test" }] })).toBe("5");
    expect(invoiceHouseNo({ notes: "nothing" })).toBeNull();
  });
  it("matches searches", () => {
    expect(matchesHouseSearch("32", "House 32")).toBe(true);
    expect(matchesHouseSearch("32", "h32")).toBe(true);
    expect(matchesHouseSearch("32", "32")).toBe(true);
    expect(matchesHouseSearch("32", "3")).toBe(false);
    expect(matchesHouseSearch("88", "house 8")).toBe(false);
    expect(matchesHouseSearch(null, "32")).toBe(false);
  });
});
