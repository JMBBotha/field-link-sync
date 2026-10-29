import { describe, it, expect } from "vitest";
import { parseCoordinates, extractMapLink, isShortMapLink, mapLinkPlaceName } from "@/lib/placeSearch";

describe("Google Maps link parsing", () => {
  const cases: [string, number, number][] = [
    ["https://www.google.com/maps/place/Wildepaardejacht/@-33.7432,19.0195,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-33.74312!4d19.02013", -33.74312, 19.02013],
    ["https://www.google.com/maps/@-33.7432,19.0195,15z", -33.7432, 19.0195],
    ["https://maps.google.com/?q=-33.7432,19.0195", -33.7432, 19.0195],
    ["https://www.google.com/maps?ll=-33.7432,19.0195&z=15", -33.7432, 19.0195],
    ["https://www.google.com/maps/search/?api=1&query=-33.7432%2C19.0195", -33.7432, 19.0195],
    ["https://www.google.com/maps/place/-33.7432,19.0195", -33.7432, 19.0195],
    ["https://www.google.com/maps/search/-33.7432,+19.0195", -33.7432, 19.0195],
    ["-33.7432, 19.0195", -33.7432, 19.0195],
    ["-33.7432 19.0195", -33.7432, 19.0195],
  ];
  it.each(cases)("%s", (u, lat, lng) => {
    expect(parseCoordinates(u)).toEqual({ lat, lng });
  });
  it("finds a short link inside iPhone share text", () => {
    const t = "Wildepaardejacht\nhttps://maps.app.goo.gl/AbCd123XyZ?g_st=ic";
    const l = extractMapLink(t)!;
    expect(l).toBe("https://maps.app.goo.gl/AbCd123XyZ?g_st=ic");
    expect(isShortMapLink(l)).toBe(true);
    expect(isShortMapLink("https://goo.gl/maps/abc")).toBe(true);
  });
  it("reads a place name from a full URL without coords", () => {
    expect(mapLinkPlaceName("https://www.google.com/maps/place/Wildepaardejacht+Farm,+Paarl")).toBe("Wildepaardejacht Farm, Paarl");
  });
  it("ignores plain text", () => {
    expect(parseCoordinates("Chase Road Paarl")).toBeNull();
    expect(extractMapLink("Chase Road Paarl")).toBeNull();
  });
});
