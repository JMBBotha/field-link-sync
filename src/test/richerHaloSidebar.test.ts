import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { v8More, v8Primary, v8Tabs } from "@/components/v8/v8Nav";

const src = (p: string) => readFileSync(p, "utf8");

/** Option 5 from the approved sidebar sketch. Options 1–4 stay out of the stylesheet. */
const RICHER_HALO =
  "radial-gradient(ellipse 125px 500px at 100% 35%, rgba(255,255,255,.27), transparent 100%), linear-gradient(180deg, transparent, rgba(0,0,0,.13))";

describe("richer-halo tablet and desktop sidebar", () => {
  const css = src("src/components/v8/v8.css");
  const side = src("src/components/v8/V8Sidebar.tsx");
  const harness = src("src/pages/RoleHomeHarness.tsx");
  const app = src("src/App.tsx");
  const frame = src("src/components/v8/roleHome/RoleMapFrame.tsx");
  const layout = src("src/components/admin/AdminLayout.tsx");

  it("paints option 5 on #3D9BEB and leaves the rejected washes out", () => {
    expect(css).toContain("background-color: #3D9BEB");
    expect(css).toContain(RICHER_HALO);
    expect(css).not.toContain("rgba(255,255,255,.055)");
    expect(css).not.toContain("rgba(255,255,255,.035)");
    expect(css).not.toContain("rgba(255,255,255,.14) 0%");
    expect(css).not.toContain("linear-gradient(180deg, transparent 0%, rgba(0,0,0,.14) 100%)");
    expect(css).toContain("rgba(255,255,255,.26)");
    expect(css).toContain("rgba(255,255,255,.28)");
    expect(css).toContain("border-radius: 14px");
    expect(css).toContain("rgba(255,255,255,.94)");
    expect(css).toContain("rgba(255,255,255,.72)");
    expect(css).toContain("letter-spacing: 2px");
    expect(css).toContain("font-weight: 700");
  });

  it("styles the persistent sidebar and the harness menu, not the phone drawer", () => {
    expect(side).toContain('className="v8-richer-halo hidden lg:block h-full w-[232px] shrink-0"');
    expect(side).toContain('className="v8-drawer absolute inset-y-0 left-0');
    expect(side).not.toMatch(/v8-drawer[^"]*v8-richer-halo/);
    expect(side).toContain("Field Lynk");
    expect(side).toContain("SYNC");
    expect(side).toContain('data-testid="v8-halo-mark"');
    expect(side).toContain("const { isAdmin } = useRole()");
    expect(side.indexOf("const { isAdmin } = useRole()")).toBeLessThan(side.indexOf("v8Primary(role"));
    expect(harness).toContain('className="v8-richer-halo v8-role-side"');
    expect(harness).toContain("{tablet && <Side");
    expect(harness).not.toContain("linear-gradient(105deg,#e8f7ff,#d9effe)");
    expect(harness).not.toContain('background: "rgba(255,255,255,.94)"');
    expect(harness).toContain('map={sp.get("map") === "1"}');
    expect(frame).toMatch(/map = true/);
    expect(layout.indexOf("<NewAdminHeader")).toBeGreaterThan(0);
    expect(layout.indexOf("<NewAdminHeader")).toBeLessThan(layout.indexOf("<SidebarC"));
  });

  it("keeps sales off the company live map and keeps the approved primary labels", () => {
    expect(v8Primary("sales").map((l) => l.label)).toEqual(["Home", "Pipeline", "Quotes", "Schedule", "Clients"]);
    expect(v8Primary("admin").map((l) => l.label)).toEqual(["Home", "Jobs", "Invoices", "Stock", "Schedule"]);
    expect(v8Primary("sales").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8More("sales").flatMap((g) => g.links).some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Tabs("sales").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Tabs("admin").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8More("admin").flatMap((g) => g.links).some((l) => l.path === "/admin/map")).toBe(true);
    expect(app).toContain('path="map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep>');
    expect(app).toContain('path="jobs-map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep>');
  });
});
