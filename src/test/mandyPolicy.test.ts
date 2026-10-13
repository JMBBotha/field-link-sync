import { describe, it, expect } from "vitest";
import { tierFor, toolAllowed, filterTools, routedCallAllowed, isSystemTool, safeVoice, safeBotName, toneBlock } from "../../supabase/functions/_shared/mandyPolicy";

const t = (name: string) => ({ type: "function", function: { name } });

describe("mandy policy", () => {
  it("maps tiers", () => {
    expect(tierFor(["admin"], {})).toBe("admin");
    expect(tierFor(["dispatcher"], {})).toBe("office");
    expect(tierFor(["admin"], { salesRep: true })).toBe("sales");
    expect(tierFor(["field_agent"], { techOnly: true })).toBe("tech");
    expect(tierFor([], {})).toBe("viewer");
  });
  it("techs get no quote or money tools", () => {
    expect(toolAllowed("tech", "list_todays_jobs")).toBe(true);
    expect(toolAllowed("tech", "add_item_to_area")).toBe(false);
    expect(toolAllowed("tech", "create_deposit_invoice")).toBe(false);
  });
  it("sales can quote but not invoice", () => {
    expect(toolAllowed("sales", "add_item_to_area")).toBe(true);
    expect(toolAllowed("sales", "create_deposit_invoice")).toBe(false);
  });
  it("system tools are always denied, unknown tools denied", () => {
    for (const n of ["update_settings", "set_pricing_rule", "edit_catalog", "save_template", "invite_user", "set_role", "change_markup"]) {
      expect(isSystemTool(n)).toBe(true);
      expect(toolAllowed("admin", n)).toBe(false);
    }
    expect(toolAllowed("admin", "something_new")).toBe(false);
    expect(toolAllowed("admin", "set_line_price")).toBe(true);
  });
  it("filters the browser tool list", () => {
    const r = filterTools("tech", [t("open_live_map"), t("add_area"), t("edit_catalog")]);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toEqual(["add_area", "edit_catalog"]);
  });
  it("checks every run_plan step", () => {
    expect(routedCallAllowed("sales", "run_plan", { steps: [{ action: "add_area" }, { action: "create_deposit_invoice" }] })).toBe(false);
    expect(routedCallAllowed("sales", "run_plan", { steps: [{ action: "add_area" }] })).toBe(true);
    expect(routedCallAllowed("tech", null, {})).toBe(true);
  });
  it("voice + name + tone", () => {
    expect(safeVoice("rex")).toBe("rex");
    expect(safeVoice("hacker")).toBe("liora");
    expect(safeBotName("<b>Zoe</b>!!")).toBe("bZoeb");
    expect(safeBotName("")).toBe("Mandy");
    const tone = toneBlock("Zoe", "Ice Age");
    expect(tone).toMatch(/friendly, professional and firm/);
    expect(tone).toMatch(/Never threatening/);
    expect(tone).toMatch(/Zoe.*Ice Age/);
  });
});
