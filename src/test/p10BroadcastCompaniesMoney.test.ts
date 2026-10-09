import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const sql = readFileSync("supabase/migrations/20261009180000_p10_broadcast_fix_companies_money.sql", "utf8");
const MONEY = ["default_rate", "units_markup_percent", "materials_markup_percent", "materials_waste_percent",
  "labour_cost_per_hour", "gp_target_percent", "sales_commission_percent"];

describe("P10 broadcast fix", () => {
  const fn = sql.slice(sql.indexOf("FUNCTION public.broadcast_lead_to_agents"), sql.indexOf("$function$;"));
  it("qualifies RETURNING and uses offer types the app accepts", () => {
    expect(fn).toMatch(/RETURNING o\.staff_id AS out_id, o\.distance_km AS out_km/);
    expect(fn).toContain("'service_call'");
    expect(fn).toContain("'sales_estimate'");
    expect(fn).not.toMatch(/,\s*'broadcast',\s*1,/);
  });
  it("tech offers must pass the shared offer-fit (15 km / travel / slot)", () => {
    expect(fn).toMatch(/_tech_offer_fit\(c\.staff_id, p_lead_id\) f WHERE f\.fits/);
    expect(fn).toContain("find_dispatch_candidates(p_lead_id, v_dispatch_role, p_radius_km, NULL)");
    expect(fn).toContain("p_radius_km numeric DEFAULT 30");
  });
});

describe("P10 lane-set re-runs auto-assign", () => {
  it("fires only when the lane is first set", () => {
    expect(sql).toMatch(/AFTER UPDATE OF primary_intent ON public\.leads[\s\S]*WHEN \(OLD\.primary_intent IS NULL AND NEW\.primary_intent IS NOT NULL\)[\s\S]*trigger_auto_assign_lead/);
  });
});

describe("P10 companies money columns", () => {
  it("revokes the still-exposed money columns and serves them via a tech-gated RPC", () => {
    expect(sql).toMatch(/REVOKE SELECT \(default_rate, units_markup_percent, materials_markup_percent\) ON public\.companies FROM authenticated/);
    expect(sql).toMatch(/get_company_pricing_settings[\s\S]*NOT public\.is_field_tech_only\(auth\.uid\(\)\)/);
  });
  it("no app code selects a hidden money column straight from companies", () => {
    const out = execSync(`grep -rn -A2 'from("companies")' src --include=*.ts --include=*.tsx | grep -v '^src/test/' | grep -i 'select' || true`).toString();
    for (const c of MONEY) expect(out).not.toContain(c);
  });
});
