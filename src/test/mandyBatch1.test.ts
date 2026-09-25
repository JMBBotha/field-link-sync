import { describe, it, expect, vi } from "vitest";
import { speakRand, speakQuoteNumber, formatForSpeech } from "@/lib/mandy/speech";
import { gateDecision } from "@/lib/mandy/gate";
import { honestMessage, refreshAfterMandyWrite, routeReached } from "@/lib/mandy/verify";
import { openMandyVoice, useMandyDock } from "@/lib/mandy/registry";

describe("A: one voice entry point", () => {
  it("Voice opens the Mandy dock listening and closes the panel", () => {
    const close = vi.fn();
    const before = useMandyDock.getState().listenRequest;
    openMandyVoice(close);
    expect(close).toHaveBeenCalled();
    expect(useMandyDock.getState().open).toBe(true);
    expect(useMandyDock.getState().listenRequest).toBe(before + 1);
  });
  it("write-then-invalidate calls invalidate, onChanged and refetch", async () => {
    const invalidate = vi.fn(), onChanged = vi.fn();
    const refetch = vi.fn(async () => ({ items: [{ id: "x" }] }));
    const fresh = await refreshAfterMandyWrite({ invalidate, onChanged, refetch });
    expect(invalidate).toHaveBeenCalled(); expect(onChanged).toHaveBeenCalled(); expect(refetch).toHaveBeenCalled();
    expect(fresh).toEqual({ items: [{ id: "x" }] });
  });
  it("routeReached checks path and query", () => {
    expect(routeReached("/admin/map?status=in_progress", "/admin/map", "?status=in_progress")).toBe(true);
    expect(routeReached("/admin/map?status=in_progress", "/admin/map", "")).toBe(false);
  });
});

describe("G: speech formatter + honest replies", () => {
  it("formats rand and quote numbers", () => {
    expect(speakRand(12762.999)).toBe("R12 763");
    expect(speakRand(9738.26)).toBe("R9 738 and 26 cents");
    expect(speakQuoteNumber("Q-2026-0014")).toBe("Q 2026 0 0 1 4");
    expect(formatForSpeech("Q-2026-0014 total R12 763.00 incl. VAT")).toBe("Q 2026 0 0 1 4 total R12 763 incl. VAT");
    expect(formatForSpeech("R 9 738,26")).toBe("R9 738 and 26 cents");
  });
  it("is not 'done' when verification fails", () => {
    const m = honestMessage({ ok: true, message: "Done. Opened Q-2026-0014.", verified: false });
    expect(m).not.toMatch(/\bdone\b|\bOpened\b/i);
    expect(m).toMatch(/couldn't confirm it on screen/);
    expect(honestMessage({ ok: true, message: "Opened it.", verified: true })).toBe("Opened it.");
  });
});

describe("E: tiered gate", () => {
  const table: [string, number, any, string][] = [
    ["set_labour_hours", 0.5, { quoteStatus: "draft" }, "run"],
    ["add_area", 0.49, { quoteStatus: "draft" }, "chips"],
    ["rename_area", 0.55, { quoteStatus: "draft" }, "run"],
    ["open_quote", 0.5, {}, "run"],
    ["read_quote_total", 0.6, { quoteStatus: "sent" }, "run"],
    ["add_item_to_area", 0.69, { quoteStatus: "draft" }, "chips"],
    ["add_item_to_area", 0.7, { quoteStatus: "draft" }, "run"],
    ["remove_item", 0.99, { quoteStatus: "draft" }, "confirm"],
    ["remove_item", 0.1, { quoteStatus: "draft" }, "confirm"],
    ["create_deposit_invoice", 0.95, {}, "confirm"],
    ["send_quote", 0.95, { quoteStatus: "draft" }, "confirm"],
    ["send_invoice", 0.3, {}, "confirm"],
    ["add_item_to_area", 0.95, { quoteStatus: "draft", belowFloor: true }, "confirm"],
    ["add_item_to_area", 0.95, { quoteStatus: "accepted" }, "block"],
    ["set_labour_hours", 0.95, { quoteStatus: "sent" }, "block"],
    ["remove_item", 0.95, { quoteStatus: "sent" }, "block"],
  ];
  it.each(table)("%s @ %s %j → %s", (a, c, ctx, kind) => {
    expect(gateDecision(a, c, ctx).kind).toBe(kind);
  });
});
