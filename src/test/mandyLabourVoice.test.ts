import { describe, it, expect, vi } from "vitest";
import { parseLabourCommand } from "@/lib/mandy/labourParse";
import { guardClaimedChange, HONESTY_HINT } from "@/lib/mandy/honesty";
import { guardQuoteWrites, withWriteFailures } from "@/lib/mandy/writeGuard";
import { runSetLabourHours, spokenRand } from "@/lib/mandy/labourAction";
import { playOnElement, MANDY_SPEECH_RATE } from "@/lib/mandy/voiceUnlock";

describe("parseLabourCommand", () => {
  it.each([
    ["add 3 hours labour to the lounge", { area: "lounge", hours: 3, mode: "add" }],
    ["add 2 and a half hours labour", { hours: 2.5, mode: "add" }],
    ["set labour to 4 hours", { hours: 4, mode: "set" }],
    ["make the labour in bedroom 1 four hours", { area: "bedroom 1", hours: 4, mode: "set" }],
    ["labour 2 hours at 750", { hours: 2, mode: "set", rate: 750 }],
    ["labour 2 hours at R750 an hour", { hours: 2, mode: "set", rate: 750 }],
  ])("%s", (t, want) => expect(parseLabourCommand(t)).toEqual(want));
  it("ignores multi-edit and non-labour", () => {
    expect(parseLabourCommand("Bedroom 3: add a 12K Samsung with 3 m kit and 2 hours labour")).toBeNull();
    expect(parseLabourCommand("open the last quote")).toBeNull();
  });
});

describe("labour spoken result", () => {
  const areas = [{ id: "B", name: "Bedroom 1" }];
  it("add creates the row", async () => {
    const addItem = vi.fn().mockResolvedValue({ id: "n" });
    const r = await runSetLabourHours({ areas, items: [], standardRate: 680, addItem, updateItem: vi.fn() }, { area: "Bedroom 1", hours: 3, mode: "add" });
    expect(r.message).toBe("Added 3 hours labour to Bedroom 1, R2 040.");
  });
  it("rate override appended", async () => {
    const r = await runSetLabourHours({ areas, items: [], standardRate: 680, addItem: vi.fn().mockResolvedValue({}), updateItem: vi.fn() }, { area: "Bedroom 1", hours: 2, mode: "set", rate: 750 });
    expect(r.message).toBe("Labour in Bedroom 1 set to 2 hours, R1 500 at R750 an hour.");
  });
  it("failed write is not claimed", async () => {
    const r = await runSetLabourHours({ areas, items: [], standardRate: 680, addItem: vi.fn().mockResolvedValue(null), updateItem: vi.fn() }, { area: "Bedroom 1", hours: 3, mode: "add" });
    expect(r.ok).toBe(false);
  });
  it("spokenRand", () => { expect(spokenRand(2040)).toBe("R2 040"); expect(spokenRand(16965.5)).toBe("R16 965,50"); });
});

describe("honesty guard", () => {
  it("replaces a claim when nothing was written", () => {
    expect(guardClaimedChange("Added 3 hours labour to Lounge.", [], [])).toBe(`I didn't change anything. ${HONESTY_HINT}`);
  });
  it("uses the failed tool's message", () => {
    expect(guardClaimedChange("Set labour to R2 040", [{ ok: false, message: "No area." }], [true])).toBe("I didn't change anything. No area.");
  });
  it("keeps real writes and read-only answers", () => {
    expect(guardClaimedChange("Added 3 hours labour.", [{ ok: true, message: "x" }], [true])).toBe("Added 3 hours labour.");
    expect(guardClaimedChange("The total is R13 963,71.", [{ ok: true, message: "t" }], [false])).toBe("The total is R13 963,71.");
  });
});

describe("write failures", () => {
  it("null addItem → ok:false message", async () => {
    const g = guardQuoteWrites({ addItem: async () => null, updateItem: async () => undefined, addArea: async () => null, updateArea: async () => undefined, deleteItem: async () => undefined, moveItemToArea: async () => undefined });
    const hs = withWriteFailures({ x: async () => { await g.addItem({}); return { ok: true, message: "Added." }; } });
    await expect(hs.x({})).resolves.toEqual({ ok: false, message: "Couldn't add the item — nothing was changed." });
  });
});

describe("speech rate", () => {
  it("playOnElement sets 1.12 with pitch preserved", () => {
    const el: any = Object.assign(new EventTarget(), { src: "", currentTime: 0, duration: NaN, play: () => Promise.resolve(), pause: () => undefined });
    playOnElement(el, "x.mp3");
    expect(el.playbackRate).toBe(MANDY_SPEECH_RATE);
    expect(el.playbackRate).toBe(1.12);
    expect(el.preservesPitch).toBe(true);
  });
});

import { parseLabourIntent, mapLabourTool } from "@/lib/mandy/labourParse";
import { buildRemoveLabour, readLabour } from "@/lib/mandy/labourAction";
import { undoLabel } from "@/components/mandy/MandyQuoteActions";
import { unknownToolMessage } from "@/lib/mandy/honesty";

const AREAS = [{ id: "G", name: "General" }, { id: "B", name: "Bedroom 1" }];
const lab = (id: string, area: string, h: number, rate = 680) => ({ id, area_id: area, item_type: "labour", quantity: h, unit_price: rate, total_price: h * rate, metadata: { labour: true, hours: h, rate } });

describe("labour intents", () => {
  it.each([
    ["remove the labour from the bedroom", { action: "remove_labour", args: { area: "bedroom" } }],
    ["remove all labour", { action: "remove_labour", args: { all: true } }],
    ["what labour is on this quote", { action: "read_labour", args: {} }],
    ["make the labour rate 750", { action: "set_labour_hours", args: { rate: 750, mode: "set" } }],
    ["change lounge labour to 2 hours", { action: "set_labour_hours", args: { area: "lounge", hours: 2, mode: "set" } }],
    ["change lounge labour to 2 hours at 700", { action: "set_labour_hours", args: { area: "lounge", hours: 2, mode: "set", rate: 700 } }],
  ])("%s", (t, want) => expect(parseLabourIntent(t)).toEqual(want));
});

describe("read_labour", () => {
  it("lists real rows", () => {
    expect(readLabour({ areas: AREAS, items: [lab("L", "G", 5.5)] }).message).toBe("Labour: General 5.5 hours at R680, R3 740; Bedroom 1 none. Total labour R3 740.");
  });
});

describe("rate-only edit", () => {
  it("updates the only labour row at the new rate", async () => {
    const updateItem = vi.fn().mockResolvedValue(undefined);
    const r = await runSetLabourHours({ areas: AREAS, items: [lab("L", "G", 5.5)], standardRate: 680, addItem: vi.fn(), updateItem }, { rate: 750 });
    expect(updateItem).toHaveBeenCalledWith("L", expect.objectContaining({ quantity: 5.5, unit_price: 750, total_price: 4125 }));
    expect(r.message).toBe("Labour in General set to 5.5 hours, R4 125 at R750 an hour.");
  });
  it("area without labour → no labour yet", async () => {
    const r = await runSetLabourHours({ areas: AREAS, items: [lab("L", "G", 5.5)], standardRate: 680, addItem: vi.fn(), updateItem: vi.fn() }, { area: "Bedroom 1", rate: 750 });
    expect(r).toEqual({ ok: false, message: "There's no labour in Bedroom 1 yet." });
  });
  it("several rows, no area → chips", async () => {
    const r = await runSetLabourHours({ areas: AREAS, items: [lab("L", "G", 5.5), lab("M", "B", 3)], standardRate: 680, addItem: vi.fn(), updateItem: vi.fn() }, { rate: 750 });
    expect(r.choices?.map((c) => c.label)).toEqual(["General", "Bedroom 1"]);
  });
});

describe("remove_labour", () => {
  it("always confirm, lists rows, then removes with undo label", async () => {
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const r = buildRemoveLabour({ areas: AREAS, items: [lab("L", "G", 5.5), lab("M", "B", 3)], deleteItem }, { area: "Bedroom 1" });
    expect(r.confirm?.lines).toEqual(["Bedroom 1 · 3 hours × R680 = R2 040"]);
    expect(deleteItem).not.toHaveBeenCalled();
    const done = await r.confirm!.run();
    expect(deleteItem).toHaveBeenCalledWith("M");
    expect(done.message).toBe("Removed labour from Bedroom 1, R2 040.");
    expect(`Undid ${undoLabel(done.message)}.`).toBe("Undid removed labour from Bedroom 1, R2 040.");
  });
  it("all=true removes every row", async () => {
    const deleteItem = vi.fn();
    const r = buildRemoveLabour({ areas: AREAS, items: [lab("L", "G", 5.5), lab("M", "B", 3)], deleteItem }, { all: true });
    expect(r.confirm?.lines).toHaveLength(2);
    await r.confirm!.run();
    expect(deleteItem).toHaveBeenCalledTimes(2);
  });
  it("unclear area → chips of areas with labour", () => {
    const r = buildRemoveLabour({ areas: AREAS, items: [lab("L", "G", 5.5), lab("M", "B", 3)], deleteItem: vi.fn() }, {});
    expect(r.choices?.map((c) => c.label)).toEqual(["General", "Bedroom 1"]);
  });
});

describe("unknown labour tools", () => {
  it("maps invented names", () => {
    expect(mapLabourTool("remove_labour_line", { area: "General" })).toEqual({ action: "remove_labour", args: { area: "General" } });
    expect(mapLabourTool("edit_labour_rate", { rate: 750 })).toEqual({ action: "set_labour_hours", args: { rate: 750, mode: "set" } });
    expect(mapLabourTool("get_labour", {})).toEqual({ action: "read_labour", args: {} });
    expect(mapLabourTool("send_fax", {})).toBeNull();
  });
  it("honest unknown reply", () => {
    expect(unknownToolMessage("edit_area_colour", false)).toBe("I can't do that here — open the quote first.");
  });
});
