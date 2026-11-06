import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  homeMapNotice,
  homeOverlayClass,
  mapFailureAction,
  mapFailureMessage,
  mapFillStyle,
  mapAvailabilityOf,
  showPhoneLiveMapButton,
} from "@/lib/phoneMapFrame";
import { v8Primary, v8Tabs, v8More } from "@/components/v8/v8Nav";

const src = (p: string) => readFileSync(p, "utf8");

describe("iPhone home and live map frame", () => {
  it("turns map errors into a visible failure without blanking the map for one tile", () => {
    expect(mapFailureAction({ status: 401 }, true)).toBe("fail");
    expect(mapFailureAction({ status: 403, message: "Forbidden" }, false)).toBe("fail");
    expect(mapFailureMessage({ status: 403 })).toBe("Map token rejected by Mapbox.");
    expect(mapFailureAction({ status: 404, url: "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/1/0/0.vector.pbf" }, false)).toBe("ignore");
    expect(mapFailureAction({ message: "AJAXError: sprite load failed" }, false)).toBe("ignore");
    expect(mapFailureAction({ message: "Failed to fetch style" }, true)).toBe("ignore");
    expect(mapFailureAction({ message: "Failed to fetch style" }, false)).toBe("fail");
    expect(mapFailureMessage({ message: "nope" })).toBe("Failed to load map. Check your connection.");
  });

  it("keeps a home notice readable until the map is ready, then hides it", () => {
    expect(homeMapNotice(mapAvailabilityOf({ failed: false, loaded: false, slow: false, message: "Connecting to Mapbox…" }))?.text).toBe("Connecting to Mapbox…");
    expect(homeMapNotice(mapAvailabilityOf({ failed: false, loaded: false, slow: true, message: "Map is taking longer than expected..." }))?.tone).toBe("info");
    const failed = homeMapNotice(mapAvailabilityOf({ failed: true, loaded: false, slow: false, message: "Map token rejected by Mapbox." }));
    expect(failed).toEqual({ tone: "error", text: "Map token rejected by Mapbox." });
    expect(homeMapNotice(mapAvailabilityOf({ failed: false, loaded: true, slow: false, message: "Map loaded!" }))).toBeNull();
  });

  it("pins the canvas with an inline fill so mapbox-gl.css cannot collapse it", () => {
    expect(mapFillStyle.position).toBe("absolute");
    expect(mapFillStyle.inset).toBe(0);
    expect(homeOverlayClass).toContain("absolute inset-0");
    expect(homeOverlayClass).not.toContain("h-full");
  });

  it("shows Live Map to an admin on the phone and not to a salesperson", () => {
    expect(showPhoneLiveMapButton(false)).toBe(true);
    expect(showPhoneLiveMapButton(true)).toBe(false);
    expect(v8Primary("admin").some((l) => l.path === "/admin/map")).toBe(true);
    expect(v8Primary("sales").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8Tabs("admin").some((l) => l.path === "/admin/map")).toBe(false);
    expect(v8More("sales").flatMap((g) => g.links).some((l) => l.path === "/admin/map")).toBe(false);
    const home = src("src/pages/admin/AdminHomePage.tsx");
    expect(home).toContain('data-testid="home-open-live-map"');
    expect(home).toContain("showPhoneLiveMapButton(isSalesRep)");
    expect(home).toContain("homeOverlayClass");
    expect(home).not.toContain("opacity-30");
    expect(home).not.toContain("opacity-70");
    expect(home).not.toContain("bg-background/60");
    expect(home).toContain('data-testid="home-map-notice"');
    const app = src("src/App.tsx");
    expect(app).toContain('path="map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep>');
    expect(app).toContain('path="jobs-map" element={<RequireRole allowedRoles={["admin","dispatcher","viewer","field_agent"]} denySalesRep>');
  });

  it("does not put map hero pages in a transformed h-full box", () => {
    const layout = src("src/components/admin/AdminLayout.tsx");
    expect(layout).toContain('data-testid="map-hero-frame"');
    expect(layout).not.toContain('isMapHeroPage ? "h-full"');
    const map = src("src/components/MapView.tsx");
    expect(map).toContain("mapFillStyle");
    expect(map).toContain('data-testid="map-unavailable"');
    expect(map).toContain('data-testid="map-loading"');
    const page = src("src/pages/admin/AdminMapPage.tsx");
    expect(page).toContain("mapPhoneControlsClass");
    expect(page).not.toContain("bottom-4 left-3");
  });
});
