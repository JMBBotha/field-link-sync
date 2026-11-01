import { describe, it, expect } from "vitest";
import { coordsFromText, mapHref, linkParts } from "@/lib/mapPin";

describe("map pin", () => {
  const notes = "https://maps.app.goo.gl/abc123 (-34.0102159, 18.4063251).";
  it("reads coordinates from notes", () => expect(coordsFromText(notes)).toEqual({ lat: -34.0102159, lng: 18.4063251 }));
  it("stored pin first, then notes, then address", () => {
    expect(mapHref({ lat: "-34.01", lng: "18.40", address: "Demo St" })).toContain("query=-34.01,18.4");
    expect(mapHref({ notes, address: "Demo St" })).toContain("query=-34.0102159,18.4063251");
    expect(mapHref({ address: "Demo St" })).toContain("query=Demo%20St");
    expect(mapHref({ lat: 0, lng: 0, address: "Demo St" })).toContain("Demo%20St");
  });
  it("linkifies without trailing punctuation", () => {
    const parts = linkParts(notes);
    expect(parts[0]).toEqual({ t: "https://maps.app.goo.gl/abc123", url: "https://maps.app.goo.gl/abc123" });
  });
});
