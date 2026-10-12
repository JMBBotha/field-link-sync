import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { e164, inCallHours, spokenOffer } from "./leadCall.ts";
const S = { call_days: [1, 2, 3, 4, 5], call_start: "08:00:00", call_end: "17:00:00" };
Deno.test("e164", () => { assertEquals(e164("082 123 4567"), "+27821234567"); assertEquals(e164("+27 82 123 4567"), "+27821234567"); assertEquals(e164("123"), null); assertEquals(e164(null), null); });
Deno.test("call hours SAST", () => {
  assertEquals(inCallHours(S, new Date("2026-10-12T11:20:00Z")), true);   // Mon 13:20 SAST
  assertEquals(inCallHours(S, new Date("2026-10-12T05:59:00Z")), false);  // Mon 07:59
  assertEquals(inCallHours(S, new Date("2026-10-12T15:00:00Z")), false);  // Mon 17:00
  assertEquals(inCallHours(S, new Date("2026-10-11T10:00:00Z")), false);  // Sunday
});
Deno.test("spoken offer", () => {
  const t = spokenOffer({ name: "Thabo Mokoena", job: "aircon installation", area: "Durbanville", date: "2026-10-13", time: "09:00:00", minutes: 120 });
  assertEquals(t.includes("Hi Thabo,"), true); assertEquals(t.includes("Durbanville"), true); assertEquals(t.includes("at 09:00"), true);
  assertEquals(t.includes("about 2 hours"), true); assertEquals(t.endsWith("Press 1 to accept, or 2 to pass."), true);
});
