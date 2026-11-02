import { describe, it, expect } from "vitest";
import { pushSupport, isPushWorkerUrl, urlB64ToUint8Array } from "./webPush";

describe("webPush", () => {
  const base = { hasSW: true, hasPush: true, key: "k", standalone: false };
  it("iPhone in Safari needs home screen", () => expect(pushSupport({ ...base, ua: "iPhone OS 17_0" })).toBe("ios-home-screen"));
  it("iPhone home-screen app is supported", () => expect(pushSupport({ ...base, ua: "iPhone OS 17_0", standalone: true })).toBe("supported"));
  it("Android Chrome supported", () => expect(pushSupport({ ...base, ua: "Android Chrome" })).toBe("supported"));
  it("no PushManager → unsupported", () => expect(pushSupport({ ...base, ua: "x", hasPush: false })).toBe("unsupported"));
  it("missing VAPID key → no-key", () => expect(pushSupport({ ...base, ua: "x", key: "" })).toBe("no-key"));
  it("stray-SW cleanup keeps only push worker", () => {
    expect(isPushWorkerUrl("https://a.app/push-sw.js")).toBe(true);
    expect(isPushWorkerUrl("https://a.app/sw.js")).toBe(false);
    expect(isPushWorkerUrl("")).toBe(false);
  });
  it("decodes VAPID key", () => expect(Array.from(urlB64ToUint8Array("AQID"))).toEqual([1, 2, 3]));
});
