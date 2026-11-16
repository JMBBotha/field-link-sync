import { describe, expect, it } from "vitest";
import { capturedName, hangupThresholdSeconds, isBareHangup, userSpeech } from "../../supabase/functions/_shared/bareHangup";

describe("bare hang-up", () => {
  it("treats a 5s call with no name and no caller speech as a hang-up", () => {
    expect(isBareHangup({
      durationSeconds: 5,
      callerName: "Unknown Caller",
      address: "Address pending — inbound call",
      userText: userSpeech([{ role: "assistant", message: "Thanks for calling 0800 Be Cool" }], "AI: Thanks for calling"),
      endedReason: "customer-ended-call",
    })).toBe(true);
  });

  it("keeps a short call that captured a name", () => {
    expect(isBareHangup({ durationSeconds: 8, callerName: "Thabo Nkosi", userText: "Thabo" })).toBe(false);
  });

  it("keeps a short call where the caller described the job", () => {
    expect(isBareHangup({
      durationSeconds: 12,
      callerName: null,
      userText: "The lounge unit is leaking, please come today",
    })).toBe(false);
  });

  it("does not treat a normal ended call with no parsed name as a hang-up once it is past the threshold", () => {
    expect(isBareHangup({
      durationSeconds: 40,
      callerName: null,
      userText: "",
      endedReason: "customer-ended-call",
    })).toBe(false);
  });

  it("treats silence with nobody on the line as a hang-up", () => {
    expect(isBareHangup({ durationSeconds: 25, callerName: null, endedReason: "silence-timed-out" })).toBe(true);
  });

  it("ignores intake that has no duration", () => {
    expect(isBareHangup({ durationSeconds: null, callerName: null })).toBe(false);
  });

  it("reads the company threshold and falls back to 15 seconds", () => {
    expect(hangupThresholdSeconds({ hangupSeconds: 30 })).toBe(30);
    expect(hangupThresholdSeconds(null)).toBe(15);
    expect(isBareHangup({ durationSeconds: 20, thresholdSeconds: 30, callerName: null })).toBe(true);
    expect(isBareHangup({ durationSeconds: 20, thresholdSeconds: 15, callerName: null })).toBe(false);
  });

  it("does not treat Unknown Caller as a captured name", () => {
    expect(capturedName("Unknown Caller")).toBeNull();
    expect(capturedName(" Sara Adams ")).toBe("Sara Adams");
  });
});
