import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  fallbackRoute,
  imageFocus,
  isImageQuestion,
  normalizeQuoteMishear,
  quoteLineImageReport,
  type LineImageFact,
} from "@/lib/mandy/honestFallback";
import { HONEST_TOOL_RULE, MISHEAR_RULE, realtimeInstructions } from "../../supabase/functions/_shared/mandyRealtime";
import { toolAllowed } from "../../supabase/functions/_shared/mandyPolicy";
import { MANDY_MIC_AUDIO } from "@/lib/mandy/voiceUnlock";
import { shouldForwardMic } from "@/lib/mandy/realtimeTurn";

const ar40: LineImageFact = {
  name: "Samsung AR40",
  code: "AR40F24C0AG/FA",
  area: "Lounge",
  catalogueImage: false,
  cardPhoto: false,
  imageStatus: "none",
  brochure: false,
};

describe("photo questions never use the quote total", () => {
  it("routes 'why is the AR40 photo missing' to read_quote_line_images", () => {
    const r = fallbackRoute({
      transcript: "why is the AR40 product photo not showing on quote Q-2026-0056",
      proposed: "read_quote_total",
      available: ["read_quote_total", "read_quote_line_images", "read_labour"],
    });
    expect(r.action).toBe("read_quote_line_images");
    expect(r.speak).toBeNull();
    expect(r.args.focus).toBe("AR40");
    expect(isImageQuestion("why isn't the brochure showing")).toBe(true);
    expect(isImageQuestion("what's the total")).toBe(false);
  });

  it("says what she cannot check when the photo tool is not on this screen", () => {
    const r = fallbackRoute({
      transcript: "why isn't the picture showing",
      proposed: "read_quote_total",
      available: ["read_quote_total", "open_last_quote"],
    });
    expect(r.action).toBeNull();
    expect(r.speak).toMatch(/can't check product photos/i);
    expect(r.speak).toMatch(/total/);
  });

  it("leaves a real total question on read_quote_total", () => {
    const r = fallbackRoute({
      transcript: "what's the total on the quote",
      proposed: "read_quote_total",
      available: ["read_quote_total", "read_quote_line_images"],
    });
    expect(r).toMatchObject({ action: "read_quote_total", speak: null });
  });

  it("describes a missing card photo and brochure from the real fields", () => {
    const msg = quoteLineImageReport("Q-2026-0056", [ar40], "AR40");
    expect(msg).toMatch(/Q-2026-0056/);
    expect(msg).toMatch(/AR40F24C0AG\/FA/);
    expect(msg).toMatch(/no product photo/);
    expect(msg).toMatch(/image status none/);
    expect(msg).toMatch(/no approved brochure/);
    expect(imageFocus("the photo on AR40")).toBe("AR40");
  });
});

describe("slide and quilt mean quote when that is obvious", () => {
  it("rewrites the mishear and still catches the photo question", () => {
    expect(normalizeQuoteMishear("why is the photo missing on the slide")).toBe("why is the photo missing on the quote");
    expect(normalizeQuoteMishear("open the last quilt")).toBe("open the last quote");
    expect(normalizeQuoteMishear("quilt the bedspread")).toBe("quilt the bedspread");
    const r = fallbackRoute({
      transcript: "why is the AR40 photo missing on the slide",
      proposed: "read_quote_total",
      available: ["read_quote_line_images"],
    });
    expect(r.action).toBe("read_quote_line_images");
  });
});

describe("prompts and mic", () => {
  it("puts the honest rule and the slide/quilt hint in both prompts", () => {
    const instructions = realtimeInstructions({ botName: "Mandy", companyName: "Massair", parent: false, tier: "admin", context: {} });
    expect(instructions).toContain(HONEST_TOOL_RULE);
    expect(instructions).toContain(MISHEAR_RULE);
    const agent = readFileSync("supabase/functions/mandy-agent/index.ts", "utf8");
    expect(agent).toContain("HONEST_TOOL_RULE");
    expect(agent).toContain("MISHEAR_RULE");
  });

  it("lets sales read line images and not techs", () => {
    expect(toolAllowed("sales", "read_quote_line_images")).toBe(true);
    expect(toolAllowed("tech", "read_quote_line_images")).toBe(false);
  });

  it("turns echo cancellation on and drops playback echo until real speech", () => {
    expect(MANDY_MIC_AUDIO).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(shouldForwardMic({ speaking: true, level: 0.05, latched: false })).toEqual({ forward: false, latched: false });
    expect(shouldForwardMic({ speaking: true, level: 0.45, latched: false })).toEqual({ forward: true, latched: true });
    expect(shouldForwardMic({ speaking: true, level: 0.05, latched: true })).toEqual({ forward: true, latched: true });
    expect(shouldForwardMic({ speaking: false, level: 0.01, latched: true })).toEqual({ forward: true, latched: false });
  });
});
