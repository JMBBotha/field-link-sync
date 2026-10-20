import { describe, it, expect } from "vitest";
import { createSoundQueue, type SoundEvent } from "./eventSounds";
describe("sound queue", () => {
  it("plays only the highest-value event of a burst and spaces sounds 4 s apart", () => {
    let now = 0; const timers: [number, () => void][] = []; const played: [number, SoundEvent][] = [];
    const q = createSoundQueue((e) => played.push([now, e]), () => now, (f, ms) => { timers.push([now + ms, f]); return 1; });
    const run = (until: number) => { for (;;) { timers.sort((a, b) => a[0] - b[0]); const t = timers[0]; if (!t || t[0] > until) break; timers.shift(); now = t[0]; t[1](); } now = until; };
    q.push("new_lead"); q.push("final_payment"); q.push("deal_closed"); run(1000);
    expect(played).toEqual([[600, "final_payment"]]);
    q.push("new_lead"); run(10000);
    expect(played[1]).toEqual([4600, "new_lead"]);
  });
});
