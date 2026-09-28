import { describe, it, expect } from "vitest";
import { isDefaultAreaName } from "@/components/quote/AreaNameLabel";
describe("isDefaultAreaName", () => {
  it("detects defaults", () => {
    for (const n of ["", "  ", null, undefined, "Area", "area 2", "AREA 12"]) expect(isDefaultAreaName(n as any)).toBe(true);
  });
  it("keeps real names", () => {
    for (const n of ["Lounge", "Area 51 lounge", "Main bedroom", "Areas", "Area2"]) expect(isDefaultAreaName(n)).toBe(false);
  });
});
