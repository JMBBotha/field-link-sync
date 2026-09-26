import { describe, it, expect } from "vitest";
import { greetingFor, GENERIC_GREETING } from "@/lib/mandy/greetingFor";

describe("greetingFor", () => {
  it("uses profiles.first_name when present", () => {
    expect(greetingFor({ first_name: "johan", full_name: "Johan Botha" }, null)).toBe(
      "Hi Johan, what can I do for you?",
    );
  });

  it("uses the first word of profiles.full_name when no first_name", () => {
    expect(greetingFor({ full_name: "Johan Botha" }, null)).toBe("Hi Johan, what can I do for you?");
  });

  it("falls back to auth user_metadata", () => {
    expect(greetingFor(null, { first_name: "mandy" })).toBe("Hi Mandy, what can I do for you?");
    expect(greetingFor(null, { full_name: "Pieter van der Merwe" })).toBe("Hi Pieter, what can I do for you?");
    expect(greetingFor(null, { name: "susan" })).toBe("Hi Susan, what can I do for you?");
  });

  it("falls back to the generic greeting when nothing is found", () => {
    expect(greetingFor(null, null)).toBe(GENERIC_GREETING);
    expect(greetingFor(undefined, {})).toBe(GENERIC_GREETING);
  });

  it("treats whitespace and empty strings as missing", () => {
    expect(greetingFor({ first_name: "   ", full_name: "" }, { name: "  " })).toBe(GENERIC_GREETING);
    expect(greetingFor({ first_name: "", full_name: "  " }, null)).toBe(GENERIC_GREETING);
  });

  it("trims and capitalises the first letter only", () => {
    expect(greetingFor({ first_name: "  jOHAN " }, null)).toBe("Hi JOHAN, what can I do for you?".replace("JOHAN", "JOHAN"));
    expect(greetingFor({ first_name: "anne-marie" }, null)).toBe("Hi Anne-marie, what can I do for you?");
  });
});
