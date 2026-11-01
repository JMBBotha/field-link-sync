import { describe, expect, it } from "vitest";
import { RETURN_REASONS, returnVisitDraft, returnVisitNote, visitsError, visitsPayload } from "@/lib/jobVisits";

describe("return visit", () => {
  it("has no default reason and stores the reason in the note", () => {
    expect(returnVisitNote("")).toBe("Return visit");
    expect(returnVisitNote("Parts needed")).toBe("Return visit: Parts needed");
    expect(returnVisitNote("Testing or commissioning")).toBe("Return visit: Testing or commissioning");
    expect(returnVisitNote("Other", "  swap valve ")).toBe("Return visit: swap valve");
    expect(returnVisitNote("Other", "")).toBe("Return visit");
    expect(RETURN_REASONS).toEqual(["Parts needed", "Finish work", "Testing or commissioning", "Client request", "Other"]);
  });
  it("draft has a blank date the user must pick, copying hours from the last visit", () => {
    const vs = [{ id: "a", date: "2030-01-01", start: "09:00", end: "13:00", tech: "t1" }];
    const d = returnVisitDraft(vs);
    expect(d).toMatchObject({ id: null, date: "", start: "09:00", end: "13:00", tech: "t1" });
    expect(visitsError([...vs, d])).toBe("Visit 2 needs a date");
  });
  it("rep payload never sends a tech but keeps the note", () => {
    const vs = [{ id: null, date: "2030-01-02", start: "08:00", end: "10:00", tech: "x", note: "Return visit" }];
    expect(visitsPayload(vs, false)[0]).toEqual({ id: null, date: "2030-01-02", start: "08:00", end: "10:00", note: "Return visit" });
    expect(visitsPayload(vs, true)[0]).toHaveProperty("tech", "x");
  });
});
