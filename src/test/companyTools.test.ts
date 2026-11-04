import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { splitCents, parseRands, nextLabels, prefixFor, summarise, filterTools, needsAttention, costText, eventLine, ageDays, type Tool } from "@/lib/companyTools";
import { v8More } from "@/components/v8/v8Nav";
import { sectionTabs } from "@/components/v8/V8SectionTabs";

const T = (o: Partial<Tool>): Tool => ({ id: o.label ?? "x", company_id: "c", label: "FK-01", name: "Flaring kit", tool_type_id: "fk", supplier_name: "Test Supplier", purchase_date: "2026-01-01",
  cost_cents: 100000, cost_tbc: false, invoice_path: "p", assigned_tech_id: null, assigned_tech_name: null, status: "in_store", status_date: "2026-01-01", retired_date: null, notes: null, purchase_batch_id: null, created_at: "", ...o });

describe("company tools helpers", () => {
  it("splits a total exactly, remainder to the first tools", () => {
    expect(splitCents(275000, 3)).toEqual([91667, 91667, 91666]);
    expect(splitCents(275000, 3).reduce((a, b) => a + b)).toBe(275000);
    expect(splitCents(5, 0)).toEqual([]);
  });
  it("parses rand amounts", () => {
    expect(parseRands("R2 750,50")).toBe(275050); expect(parseRands("2750")).toBe(275000); expect(parseRands("")).toBeNull(); expect(parseRands("abc")).toBeNull();
  });
  it("labels continue from the highest existing", () => {
    expect(nextLabels("fk", ["FK-01", "FK-03"], 2)).toEqual(["FK-04", "FK-05"]);
    expect(nextLabels("VP", [], 1)).toEqual(["VP-01"]);
    expect(prefixFor("Flaring kit")).toBe("FK"); expect(prefixFor("Drill")).toBe("DR");
  });
  it("summarises per type incl. lifespan, replacements and TBC spend", () => {
    const tools = [T({ label: "FK-01", status: "in_use" }), T({ label: "FK-02", cost_cents: null, cost_tbc: true }),
      T({ label: "FK-03", status: "lost", status_date: "2026-03-02" }), T({ label: "VP-01", tool_type_id: "vp", status: "retired", retired_date: "2026-01-31" })];
    const [fk, vp, gs] = summarise([{ id: "fk", company_id: null, name: "Flaring kit" }, { id: "vp", company_id: null, name: "Vacuum pump" }, { id: "gs", company_id: null, name: "Gauge set" }], tools, "2026-11-03");
    expect(fk).toMatchObject({ owned: 2, in_use: 1, in_store: 1, ended: 1, avg_life_days: 60, replaced_12m: 1, spend_cents: 200000, tbc: 1 });
    expect(vp).toMatchObject({ owned: 0, avg_life_days: 30 }); expect(gs).toMatchObject({ owned: 0, avg_life_days: null, spend_cents: 0 });
  });
  it("filters hide retired by default and sort labels numerically", () => {
    const tools = [T({ label: "FK-10" }), T({ label: "FK-2" }), T({ label: "FK-03", status: "retired" })];
    expect(filterTools(tools, {}).map((t) => t.label)).toEqual(["FK-2", "FK-10"]);
    expect(filterTools(tools, { status: "all" })).toHaveLength(3);
    expect(filterTools(tools, { status: "retired" }).map((t) => t.label)).toEqual(["FK-03"]);
  });
  it("needs attention = broken, lost, or missing invoice (not retired)", () => {
    expect(needsAttention([T({ status: "broken" }), T({ invoice_path: null }), T({ status: "retired", invoice_path: null }), T({})])).toHaveLength(2);
  });
  it("cost and history text", () => {
    expect(costText({ cost_cents: null, cost_tbc: true })).toBe("TBC");
    expect(costText({ cost_cents: 91667, cost_tbc: true })).toBe("R 916,67 (TBC)");
    expect(eventLine({ id: "1", tool_id: "t", event: "issued", from_status: "in_store", to_status: "in_use", tech_name: "Tech A", done_by_name: "Owner A", event_date: "", note: null })).toBe("Issued to Tech A · by Owner A");
    expect(eventLine({ id: "1", tool_id: "t", event: "reported", from_status: "in_use", to_status: "lost", tech_name: "Tech A", done_by_name: "Tech A", event_date: "", note: "site" })).toBe("Reported lost · by Tech A · site");
    expect(ageDays(T({ purchase_date: "2026-11-01" }), "2026-11-03")).toBe(2);
  });
});

describe("company tools wiring", () => {
  it("admin sidebar has Company tools under Catalogue & stock, hidden from managers; techs get My tools", () => {
    const g = v8More("admin").find((x) => x.title === "Catalogue & stock")!;
    const i = g.links.findIndex((l) => l.path === "/admin/oss-extras");
    expect(g.links[i + 1]).toMatchObject({ path: "/admin/tools", label: "Company tools" });
    expect(v8More("admin", { manager: true }).flatMap((x) => x.links).some((l) => l.path === "/admin/tools")).toBe(false);
    expect(v8More("tech").flatMap((x) => x.links).some((l) => l.path === "/field/my-tools")).toBe(true);
    expect(sectionTabs("extras").map((t) => t.label)).toEqual(["Extras", "Consumables", "Company tools"]);
  });
  it("routes are guarded and the UI never deletes a tool", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="tools" element={<RequireRole allowedRoles={\["admin"\]}/);
    expect(app).toContain('path="/field/my-tools"');
    for (const f of ["src/pages/admin/AdminCompanyToolsPage.tsx", "src/components/tools/ToolDetail.tsx", "src/components/tools/api.ts", "src/pages/field/MyToolsPage.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/\)\s*\.(delete|insert|update|upsert)\(/); // all writes go through RPCs
      expect(s).not.toMatch(/0800 232 665|Ind CC/);
    }
  });
  it("seed is a separate file and the migration has a rollback", () => {
    expect(readFileSync("supabase/seed/20261103_company_tools_massair_ct.sql", "utf8")).toContain("FK-03");
    expect(readFileSync("supabase/manual/20261103130000_company_tools_rollback.sql", "utf8")).toMatch(/DROP TABLE/i);
  });
});
