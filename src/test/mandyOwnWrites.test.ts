import { describe, it, expect, vi } from "vitest";
import { withBeforeWrite } from "@/lib/mandyBeforeWrite";

describe("withBeforeWrite", () => {
  it("runs beforeWrite before the handler", async () => {
    const order: string[] = [];
    const hs = withBeforeWrite({ a: async () => { order.push("h"); return { ok: true, message: "done" }; } },
      async () => { order.push("b"); return null; });
    const r = await hs.a({});
    expect(order).toEqual(["b", "h"]);
    expect(r.ok).toBe(true);
  });
  it("runs beforeWrite again before confirm.run", async () => {
    const order: string[] = [];
    const hs = withBeforeWrite({
      a: async () => ({ ok: true, message: "confirm?", confirm: { summary: "s", run: async () => { order.push("run"); return { ok: true, message: "ran" }; } } }),
    }, async () => { order.push("b"); return null; });
    const r = await hs.a({});
    await r.confirm!.run();
    expect(order).toEqual(["b", "b", "run"]);
  });
  it("a string blocks the write", async () => {
    const h = vi.fn(async () => ({ ok: true, message: "x" }));
    const r = await withBeforeWrite({ a: h }, async () => "nope").a({});
    expect(r).toEqual({ ok: false, message: "nope" });
    expect(h).not.toHaveBeenCalled();
  });
  it("a string blocks confirm.run", async () => {
    const run = vi.fn(async () => ({ ok: true, message: "ran" }));
    let n = 0;
    const hs = withBeforeWrite({ a: async () => ({ ok: true, message: "c", confirm: { summary: "s", run } }) }, async () => (n++ ? "blocked" : null));
    const r = await hs.a({});
    expect(await r.confirm!.run()).toEqual({ ok: false, message: "blocked" });
    expect(run).not.toHaveBeenCalled();
  });
  it("no beforeWrite leaves handlers untouched", () => {
    const hs = { a: async () => ({ ok: true, message: "" }) };
    expect(withBeforeWrite(hs)).toBe(hs);
  });
});
