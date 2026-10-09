import { describe, it, expect } from "vitest";
import { ROLE_COLOURS, roleKindFromLabel, roleLabelFor, roleColours } from "@/lib/roleColours";

describe("role colours", () => {
  it("maps badge labels to colour families", () => {
    expect(roleKindFromLabel("Admin")).toBe("admin");
    expect(roleKindFromLabel("Sales")).toBe("sales");
    expect(roleKindFromLabel("Technician")).toBe("tech");
    expect(roleKindFromLabel("Office")).toBe("office");
    expect(roleKindFromLabel(undefined)).toBeNull();
    expect(roleColours(null)).toBeNull();
  });
  it("admin orange, sales blue, technician green", () => {
    expect(ROLE_COLOURS.admin.strip).toContain("orange");
    expect(ROLE_COLOURS.sales.strip).toContain("blue");
    expect(ROLE_COLOURS.tech.strip).toContain("emerald");
  });
  it("keeps the badge's role precedence", () => {
    expect(roleLabelFor(["admin", "field_agent"], "sales")).toBe("Admin");
    expect(roleLabelFor(["field_agent", "dispatcher"], "sales")).toBe("Technician");
    expect(roleLabelFor(["dispatcher"], "sales_engineer")).toBe("Sales");
    expect(roleLabelFor(["dispatcher"], "office")).toBe("Office");
  });
});
