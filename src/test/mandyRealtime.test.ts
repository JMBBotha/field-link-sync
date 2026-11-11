import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  base64Pcm16ToFloat32,
  bargeIn,
  continueAfterTool,
  downsampleFloat,
  floatToPcm16Base64,
  forceMessageItem,
  functionCallOutputMessage,
  isUserFacingSentence,
  mandyRealtimeEnabled,
  mandyStatusLabel,
  nextMandyPhase,
  phaseAfterResponseDone,
  replyPlan,
  rmsLevel,
  shouldRequestContinuation,
  shouldWaitForQuoteTools,
  spokenToolText,
  type MandyPhase,
  type MandyTurnEvent,
} from "@/lib/mandy/realtimeTurn";
import { prepareRealtimeSession, readClientSecret, realtimeSocketUrl, MANDY_REALTIME_VOICE } from "../../supabase/functions/_shared/mandyRealtime";

const t = (name: string, description = name) => ({ type: "function", function: { name, description, parameters: { type: "object", properties: {} } } });

describe("mandy realtime turn state", () => {
  it("never shows Ready from the moment a turn starts until the session closes", () => {
    const events: MandyTurnEvent[] = [
      { type: "connect_start" },
      { type: "session_live" },
      { type: "speech_started" },
      { type: "speech_stopped" },
      { type: "response_created" },
      { type: "audio_out" },
      { type: "response_done", audioQueued: true },
      { type: "playback_ended" },
      { type: "speech_started" },
      { type: "speech_stopped" },
      { type: "function_call" },
      { type: "audio_out" },
      { type: "playback_ended" },
    ];
    let phase: MandyPhase = "idle";
    for (const e of events) {
      phase = nextMandyPhase(phase, e);
      expect(phase).not.toBe("idle");
      expect(mandyStatusLabel(phase)).not.toBe("Ready");
    }
    expect(mandyStatusLabel(nextMandyPhase(phase, { type: "session_closed" }))).toBe("Ready");
  });

  it("labels listening, hearing, thinking and speaking in readable words", () => {
    expect(mandyStatusLabel("listening")).toBe("Listening…");
    expect(mandyStatusLabel("hearing")).toBe("Hearing you…");
    expect(mandyStatusLabel("thinking")).toBe("Thinking…");
    expect(mandyStatusLabel("working")).toBe("Thinking…");
    expect(mandyStatusLabel("speaking")).toBe("Mandy is speaking…");
    expect(mandyStatusLabel("greeting")).toBe("Mandy is speaking…");
  });

  it("stays on Speaking until playback ends, and Thinking while a tool is outstanding", () => {
    expect(phaseAfterResponseDone({ hadAudio: true, pendingTools: 0, playbackPending: false })).toBe("speaking");
    expect(phaseAfterResponseDone({ hadAudio: false, pendingTools: 1, playbackPending: false })).toBe("thinking");
    expect(phaseAfterResponseDone({ hadAudio: false, pendingTools: 0, playbackPending: false })).toBe("listening");
    expect(nextMandyPhase("speaking", { type: "playback_ended" })).toBe("listening");
  });

  it("barge-in stops her audio and returns to Listening", () => {
    expect(bargeIn("speaking")).toEqual({ phase: "listening", stopPlayback: true });
    expect(bargeIn("listening").stopPlayback).toBe(false);
  });
});

describe("mandy realtime skip-second-call", () => {
  it("speaks a finished tool sentence and does not ask the model to rephrase it", () => {
    const result = { ok: true, message: "Opened Q-2026-0056 for Smith." };
    expect(isUserFacingSentence(result.message)).toBe(true);
    expect(continueAfterTool("open_last_quote", result, "open the last quote")).toBe("speak");
    expect(replyPlan([{ action: "open_last_quote", result }], "open the last quote")).toBe("speak");
    const forced = forceMessageItem(result.message);
    expect(forced.item.type).toBe("force_message");
    expect(forced.item.content[0].text).toBe(result.message);
    expect(shouldRequestContinuation(1, 1, true)).toBe(true);
    expect(shouldRequestContinuation(2, 1, true)).toBe(false);
  });

  it("continues only when another tool is actually needed", () => {
    const opened = { ok: true, message: "Opened Q-2026-0056 for Smith." };
    expect(continueAfterTool("open_last_quote", opened, "open the last quote and add a Samsung")).toBe("continue");
    expect(shouldWaitForQuoteTools("open_last_quote", "open the last quote")).toBe(false);
    expect(shouldWaitForQuoteTools("open_last_quote", "open the last quote and read the total")).toBe(true);
    expect(shouldWaitForQuoteTools("add_item_to_area", "add a Samsung")).toBe(false);
    expect(continueAfterTool("add_note", { ok: true, message: "" }, "add a note")).toBe("continue");
    expect(continueAfterTool("open_quote", { ok: true, message: "3 quotes match. Waiting for the user to tap one.", choices: [{ label: "Q-1", action: "open_quote", args: {} }] }, "open the smith quote")).toBe("speak");
  });

  it("sends the tool sentence back as say, with tap and confirm flags", () => {
    const msg = functionCallOutputMessage("call_1", {
      ok: true,
      message: "Opened Q-2026-0056.",
      confirm: { summary: "Send this?", run: async () => ({ ok: true, message: "Sent." }) },
    });
    const body = JSON.parse(msg.item.output);
    expect(body.say).toBe("Opened Q-2026-0056.");
    expect(body.awaiting_confirmation).toBe("Send this?");
    expect(spokenToolText([{ message: "Opened Q-2026-0056." }, { message: "" }])).toBe("Opened Q-2026-0056.");
  });
});

describe("mandy realtime session config", () => {
  it("uses eve, server VAD, and only the tools this role may see", () => {
    const prepared = prepareRealtimeSession({
      tier: "tech",
      parent: false,
      botName: "Mandy",
      companyName: "Massair",
      context: { page: "today" },
      tools: [t("open_live_map", "Open the map"), t("add_area", "Add an area"), t("__preview_plan", "hidden"), { type: "function", function: { name: "edit_catalog", description: "no" } }],
    });
    expect(prepared.url).toContain("wss://api.x.ai/v1/realtime");
    expect(prepared.url).toContain("model=grok-voice-latest");
    expect(prepared.url).toContain("reasoning.effort=none");
    expect(prepared.session.voice).toBe(MANDY_REALTIME_VOICE);
    expect(prepared.session.turn_detection.type).toBe("server_vad");
    expect(prepared.session.tools.map((tool) => tool!.name)).toEqual(["open_live_map"]);
    expect(prepared.dropped).toEqual(["add_area", "__preview_plan", "edit_catalog"]);
    expect(prepared.session.instructions).toMatch(/Massair/);
    expect(prepared.session.instructions).toMatch(/speak that sentence/);
    expect(JSON.stringify(prepared)).not.toMatch(/XAI_API_KEY|sk-/);
  });

  it("reads the client secret and drops anything else in the mint response", () => {
    expect(readClientSecret({ value: "xai-realtime-client-secret-abc", expires_at: 100, extra: "no" })).toEqual({ token: "xai-realtime-client-secret-abc", expiresAt: 100 });
    expect(readClientSecret({ value: "short" })).toBeNull();
    expect(realtimeSocketUrl("conv_1")).toContain("conversation_id=conv_1");
  });

  it("the edge function mints the token server-side and does not touch Vapi", () => {
    const src = readFileSync("supabase/functions/mandy-realtime/index.ts", "utf8");
    expect(src).toContain("https://api.x.ai/v1/realtime/client_secrets");
    expect(src).toContain('Deno.env.get("XAI_API_KEY")');
    expect(src).not.toMatch(/xai-[A-Za-z0-9]{16,}/);
    expect(src.toLowerCase()).not.toContain("vapi");
  });

  it("flag off keeps the old pipeline", () => {
    expect(mandyRealtimeEnabled(undefined)).toBe(true);
    expect(mandyRealtimeEnabled("")).toBe(true);
    expect(mandyRealtimeEnabled("0")).toBe(false);
    expect(mandyRealtimeEnabled("legacy")).toBe(false);
    expect(mandyRealtimeEnabled("on")).toBe(true);
  });
});

describe("mandy realtime audio helpers", () => {
  it("downsamples and round-trips PCM16", () => {
    const input = new Float32Array([0.5, 0.5, -0.25, -0.25]);
    expect(Array.from(downsampleFloat(input, 48000, 24000))).toEqual([0.5, -0.25]);
    expect(rmsLevel(new Float32Array(8))).toBe(0);
    const b64 = floatToPcm16Base64(new Float32Array([0, 0.5, -0.5]));
    const back = base64Pcm16ToFloat32(b64);
    expect(back[0]).toBe(0);
    expect(back[1]).toBeGreaterThan(0.49);
    expect(back[2]).toBeLessThan(-0.49);
  });
});
