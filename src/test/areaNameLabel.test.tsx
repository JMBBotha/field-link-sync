import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AreaNameLabel, isDefaultAreaName } from "@/components/quote/AreaNameLabel";
describe("isDefaultAreaName", () => {
  it("detects defaults", () => {
    for (const n of ["", "  ", null, undefined, "Area", "area 2", "AREA 12"]) expect(isDefaultAreaName(n as any)).toBe(true);
  });
  it("keeps real names", () => {
    for (const n of ["Lounge", "Area 51 lounge", "Main bedroom", "Areas", "Area2"]) expect(isDefaultAreaName(n)).toBe(false);
  });
  it("prints no synthetic default label", () => {
    const { container } = render(<AreaNameLabel name="Add items to quote" isDefault onRename={() => {}} />);
    expect(container.querySelector(".print\\:inline")?.textContent).toBe("");
  });
});
