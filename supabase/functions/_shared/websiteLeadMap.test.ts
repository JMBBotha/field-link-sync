import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { laneFor, mapServiceType, normaliseForm, requestedTimeLine } from "./websiteLeadMap.ts";
import { honeypotTripped, isAllowedOrigin, withoutHoneypot } from "./websitePublic.ts";

Deno.test("quote accepted is an installation (ordering bug fixed)", () => {
  assertEquals(mapServiceType("Quote accepted - book the installation"), "New Installation");
  assertEquals(mapServiceType("Book the installation"), "New Installation");
  assertEquals(mapServiceType("Sales quote"), "New Quote");
  assertEquals(mapServiceType("New installation quote"), "New Quote");
  assertEquals(mapServiceType("Multi-unit project quote"), "New Quote");
});
Deno.test("service lane", () => {
  assertEquals(mapServiceType("Repair / diagnosis service call"), "Technical Service Call");
  assertEquals(mapServiceType("Super Service (maintenance)"), "Technical Service Call");
  assertEquals(laneFor(mapServiceType("Repair / diagnosis service call")), "service");
});
Deno.test("website forms default to sales", () => {
  for (const f of ["find-ac", "packs", "selection", "shop"] as const) {
    assertEquals(mapServiceType(undefined, f), "New Quote");
    assertEquals(laneFor(mapServiceType("", f)), "sales");
  }
  assertEquals(mapServiceType("Comfort pack"), "New Quote");
  assertEquals(laneFor(mapServiceType("Other / get help")), null);
  assertEquals(laneFor(mapServiceType(undefined, "booking")), null);
});
Deno.test("form tag", () => {
  assertEquals(normaliseForm("find_ac"), "find-ac");
  assertEquals(normaliseForm("Packs"), "packs");
  assertEquals(normaliseForm("booking"), "booking");
  assertEquals(normaliseForm("whatever"), "other");
});
Deno.test("requested time is a request, not a booking", () => {
  assertEquals(requestedTimeLine("2026-10-22", "09:30"), "Requested time (not booked yet, confirm with the client): 2026-10-22 09:30");
  assertEquals(requestedTimeLine(null, null), "");
  assertEquals(requestedTimeLine("22/10/2026", ""), "");
});
Deno.test("origins", () => {
  assertEquals(isAllowedOrigin("https://www.0800becool.co.za"), true);
  assertEquals(isAllowedOrigin("https://0800becool.co.za/"), true);
  assertEquals(isAllowedOrigin("https://id-preview--a0033055-dead-4c27-b52b-8118cb332010.lovable.app"), true);
  assertEquals(isAllowedOrigin("https://ac-connection-hub.lovable.app"), true);
  assertEquals(isAllowedOrigin("https://field-link-sync.lovable.app"), false);
  assertEquals(isAllowedOrigin("https://evil.example.com"), false);
  assertEquals(isAllowedOrigin("https://0800becool.co.za.evil.com"), false);
  assertEquals(isAllowedOrigin(null), false);
});
Deno.test("honeypot", () => {
  assertEquals(honeypotTripped({ name: "A", company_website: "" }), false);
  assertEquals(honeypotTripped({ name: "A", company_website: "http://spam" }), true);
  assertEquals(honeypotTripped({ hp: "x" }), true);
  assertEquals(Object.keys(withoutHoneypot({ a: 1, hp: "", company_website: "" })), ["a"]);
});
