import { describe, expect, it } from "vitest";
import { decideAddTarget } from "@/lib/addBarTarget";

const areas = [{ id: "lounge" }, { id: "bedroom" }];

describe("decideAddTarget", () => {
  it("creates an area when none exist", () => {
    expect(decideAddTarget([], [], false)).toEqual({ kind: "new" });
  });

  it("uses the only area for a non-unit", () => {
    expect(decideAddTarget([areas[0]], [], false)).toEqual({ kind: "existing", areaId: "lounge" });
  });

  it("uses the last area when adding a unit and that area has no unit", () => {
    expect(decideAddTarget(areas, [{ areaId: "lounge", isUnit: true }], true)).toEqual({
      kind: "existing",
      areaId: "bedroom",
    });
  });

  it("creates a new area when the last area already has a unit", () => {
    expect(decideAddTarget(areas, [{ areaId: "bedroom", isUnit: true }], true)).toEqual({ kind: "new" });
  });

  it("asks for an area for a non-unit when several exist and defaults to the last", () => {
    expect(decideAddTarget(areas, [], false)).toEqual({ kind: "pick", defaultAreaId: "bedroom" });
  });
});