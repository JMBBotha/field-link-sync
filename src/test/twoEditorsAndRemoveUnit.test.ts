import { describe, it, expect } from "vitest";
import { stampChanged, stampFromRows, mergeStamps } from "@/lib/quoteLineStamp";
import { applyUnitRemoval, linkedToUnit } from "@/lib/unitInstallLinks";

const base = stampFromRows([{ id: "a", updated_at: "2026-09-29T10:00:00Z" }, { id: "b", updated_at: "2026-09-29T10:05:00Z" }]);

describe("quote line stamp", () => {
  it("new id -> changed", () => {
    expect(stampChanged(base, stampFromRows([{ id: "a", updated_at: "2026-09-29T10:00:00Z" }, { id: "c", updated_at: "2026-09-29T09:00:00Z" }]))).toBe(true);
  });
  it("later updated_at -> changed", () => {
    expect(stampChanged(base, stampFromRows([{ id: "a", updated_at: "2026-09-29T10:06:00Z" }]))).toBe(true);
  });
  it("identical -> not changed", () => {
    expect(stampChanged(base, stampFromRows([{ id: "a", updated_at: "2026-09-29T10:00:00Z" }, { id: "b", updated_at: "2026-09-29T10:05:00Z" }]))).toBe(false);
  });
  it("merge keeps ids and the later time", () => {
    const m = mergeStamps(base, stampFromRows([{ id: "z", updated_at: "2026-09-29T11:00:00Z" }]));
    expect([...m.ids].sort()).toEqual(["a", "b", "z"]);
    expect(m.maxUpdatedAt).toBe("2026-09-29T11:00:00Z");
  });
});

type L = { id: string; unitKey?: string };
const lines: L[] = [{ id: "u1" }, { id: "k1", unitKey: "u1" }, { id: "d1", unitKey: "u1" }, { id: "k2", unitKey: "u2" }, { id: "m" }];
const key = (l: L) => l.unitKey;
const clear = (l: L): L => ({ id: l.id });

describe("unit install links", () => {
  it("finds lines linked to a unit", () => expect(linkedToUnit(lines, "u1", key).map((l) => l.id)).toEqual(["k1", "d1"]));
  it("Yes removes the unit and its install lines", () => {
    expect(applyUnitRemoval(lines, "u1", (l) => l.id === "u1", key, clear, true).map((l) => l.id)).toEqual(["k2", "m"]);
  });
  it("No removes only the unit and unlinks the rest", () => {
    const out = applyUnitRemoval(lines, "u1", (l) => l.id === "u1", key, clear, false);
    expect(out.map((l) => l.id)).toEqual(["k1", "d1", "k2", "m"]);
    expect(out.find((l) => l.id === "k1")!.unitKey).toBeUndefined();
    expect(out.find((l) => l.id === "k2")!.unitKey).toBe("u2");
  });
});
