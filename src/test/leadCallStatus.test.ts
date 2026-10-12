import { describe, it, expect } from "vitest";
import { callChip } from "@/lib/leadCallStatus";
const base = { lead_id: "l", person: null, at: null, n_passed: 0, n_no_answer: 0, n_called: 0, dry_run: false };
describe("lead call chip", () => {
  it("accepted shows who and SAST time", () => expect(callChip({ ...base, state: "accepted", person: "Thabo", at: "2026-10-12T11:42:00Z" })?.text).toBe("Accepted by Thabo by phone at 13:42"));
  it("calling shows passes", () => expect(callChip({ ...base, state: "calling", person: "Thabo", n_passed: 2 })?.text).toBe("Calling Thabo… (2 passed)"));
  it("ended with no answers", () => expect(callChip({ ...base, state: "ended", n_called: 3, n_no_answer: 3 })?.text).toBe("Phoned 3: 3 no answer"));
  it("no row = no chip", () => expect(callChip(undefined)).toBeNull());
});
