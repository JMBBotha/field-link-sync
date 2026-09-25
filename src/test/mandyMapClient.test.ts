import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { makeMapHandlers } from "@/lib/mandy/mapStatus";
import { postProcessRoute } from "@/lib/mandy/router";
import { buildFindClientResult } from "@/lib/mandy/clientChoices";

describe("Mandy map coercion", () => {
  it("open_live_map with status 'in progress' navigates with the filter", async () => {
    const nav = vi.fn();
    await makeMapHandlers(nav).open_live_map({ status: "in progress" });
    expect(nav).toHaveBeenCalledWith("/admin/map?status=in_progress");
  });
  it("plain open_live_map still opens /admin/map", async () => {
    const nav = vi.fn();
    await makeMapHandlers(nav).open_live_map({});
    expect(nav).toHaveBeenCalledWith("/admin/map");
  });
  it("router turns 'show the live map, only in-progress jobs' into a filter", () => {
    const r = postProcessRoute({ action: "open_live_map", args: {}, confidence: 0.9 }, "show the live map, only in-progress jobs");
    expect(r.action).toBe("filter_map_by_status");
    expect(r.args).toEqual({ status: "in_progress" });
  });
  it("router leaves 'open the live map' alone", () => {
    const r = postProcessRoute({ action: "open_live_map", args: {}, confidence: 0.9 }, "open the live map");
    expect(r.action).toBe("open_live_map");
  });
});

describe("find_client chips", () => {
  it("2 matches → 2 client chips + Add new", () => {
    const r = buildFindClientResult("wicus", [{ id: "a", name: "Wicus Schoeman" }, { id: "b", name: "Wicus Smit" }], false);
    expect(r.choices!.map((c) => c.label)).toEqual(["Wicus Schoeman", "Wicus Smit", "Add new client"]);
    expect(r.openClientId).toBeUndefined();
  });
  it("1 exact match → opens it and still shows a chip", () => {
    const r = buildFindClientResult("TEST Mandy", [{ id: "t", name: "TEST Mandy" }], true);
    expect(r.openClientId).toBe("t");
    expect(r.message).toBe("Opened TEST Mandy.");
    expect(r.choices!.some((c) => c.action === "open_client")).toBe(true);
  });
  it("0 matches → Add new chip", () => {
    const r = buildFindClientResult("nobody", [], false);
    expect(r.choices).toEqual([expect.objectContaining({ action: "add_new_client", label: "Add new client" })]);
  });
});
