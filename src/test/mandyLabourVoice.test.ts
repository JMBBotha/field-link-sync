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
