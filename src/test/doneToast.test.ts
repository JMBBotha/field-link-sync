import { describe, it, expect } from "vitest";
import { doneMessage, doneTime } from "@/lib/doneToast";
describe("R3 done states", () => {
  it("formats what · HH:MM in SAST", () => {
    const at = new Date("2026-10-18T12:02:00Z");
    expect(doneTime(at)).toBe("14:02");
    expect(doneMessage("Quote Q-2026-0023 sent to Mrs Smith", at)).toBe("Quote Q-2026-0023 sent to Mrs Smith · 14:02");
  });
});
