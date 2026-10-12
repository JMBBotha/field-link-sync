import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { sidebarRoleLabel } from "@/lib/sidebarRoleLabel";

describe("sidebar role label", () => {
  it("owner plus stored roles; sales/tech for staff", () => {
    expect(sidebarRoleLabel(["admin"], false)).toBe("owner · admin");
    expect(sidebarRoleLabel(["admin", "field_agent"], false)).toBe("owner · admin · tech");
    expect(sidebarRoleLabel(["dispatcher"], true)).toBe("sales");
    expect(sidebarRoleLabel(["field_agent"], false)).toBe("tech");
    expect(sidebarRoleLabel(["dispatcher"], false)).toBe("dispatcher");
  });
});
describe("sidebar bottom block", () => {
  it("is one collapsible Settings & account group, closed by default", () => {
    const s = readFileSync("src/components/admin/AdminSidebar.tsx", "utf8");
    expect(s).toContain("useState(false);\n  // Bottom \"Settings & account\"");
    expect(s).toContain("Settings &amp; account");
    expect(s).toMatch(/\{accountOpen && \(<>[\s\S]*Sign Out[\s\S]*<\/>\)\}/);
  });
});
