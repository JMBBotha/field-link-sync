/**
 * iPhone Home + Live Map frame.
 *
 * Safari resolves height:100% (Tailwind h-full) inside a flex item whose only
 * height is the used flex size — Tailwind flex-1 is flex-basis:0% — as 0.
 * overflow:auto on that box then clips the dashboard, so Home is an empty wash.
 * The Live Map page is the same chain: the absolutely positioned leads button
 * still paints (it has its own size) and the app ambient gradient shows through
 * the zero-height page. Fill these pages with flex, and scroll the Home overlay
 * with absolute inset, not h-full.
 *
 * Mapbox GL also leaves the canvas blank on iOS when an ancestor has a CSS
 * transform (the layout fade) or when the canvas sits under opacity / a
 * backdrop-filter. .mapboxgl-map { position:relative } beats a Tailwind
 * absolute class and can collapse the canvas; the fill is an inline style.
 */

export const mapHeroShellClass = "relative flex min-h-0 flex-1 flex-col";
export const mapHeroStageClass = "relative min-h-0 flex-1";

/** Scrolling dashboard over the map. Absolute against the flex stage. */
export const homeOverlayClass =
  "absolute inset-0 z-10 overflow-y-auto overflow-x-hidden p-3 pb-24 md:p-4 md:pb-20 lg:pb-4 space-y-3";

/**
 * Classic home keeps a light wash so the old solid cards stay readable.
 * The approved role homes do not: a wash over the whole stage hides the streets.
 */
export function homeMapWash(isClassic: boolean): string | null {
  return isClassic ? "hsl(var(--background) / 0.35)" : null;
}

/** Wins over mapbox-gl.css .mapboxgl-map { position: relative }. */
export const mapFillStyle: {
  position: "absolute";
  inset: 0;
  width: "100%";
  height: "100%";
} = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

/** Clears the fixed phone tab bar (h-16) and the home-indicator inset. */
export const mapPhoneControlsClass =
  "lg:hidden absolute left-3 z-20 flex flex-col gap-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]";

export type MapAvailabilityState = "loading" | "slow" | "ready" | "failed";

export interface MapAvailability {
  state: MapAvailabilityState;
  message: string;
}

export function mapAvailabilityOf(input: {
  failed: boolean;
  loaded: boolean;
  slow: boolean;
  message: string;
}): MapAvailability {
  if (input.failed) return { state: "failed", message: input.message || "Map unavailable" };
  if (input.loaded) return { state: "ready", message: input.message };
  if (input.slow) return { state: "slow", message: input.message || "Map is taking longer than expected…" };
  return { state: "loading", message: input.message || "Connecting to Mapbox…" };
}

/** Readable Home notice. Hidden once tiles are up so it never covers the dashboard. */
export function homeMapNotice(a: MapAvailability | null): { tone: "info" | "error"; text: string } | null {
  if (!a || a.state === "ready") return null;
  if (a.state === "failed") return { tone: "error", text: a.message || "Map unavailable" };
  if (a.state === "slow") return { tone: "info", text: a.message || "Map is taking longer than expected…" };
  return { tone: "info", text: a.message || "Connecting to Mapbox…" };
}

export interface MapboxErrorLike {
  status?: number;
  message?: string;
  url?: string;
}

/**
 * 401/403 always blank the map (token missing or URL-restricted).
 * A tile, sprite, or glyph miss must not: one failed tile is not a dead map.
 * Anything else before the style has loaded blanks it.
 */
export function mapFailureAction(err: MapboxErrorLike | null | undefined, styleLoaded: boolean): "fail" | "ignore" {
  const status = err?.status;
  if (status === 401 || status === 403) return "fail";
  const url = err?.url || "";
  const message = err?.message || "";
  if (/\/(tiles|sprite|fonts|glyphs|v4)\//i.test(url) || /sprite|glyph|tileset/i.test(message)) return "ignore";
  if (styleLoaded) return "ignore";
  return "fail";
}

export function mapFailureMessage(err: MapboxErrorLike | null | undefined): string {
  const status = err?.status;
  if (status === 401 || status === 403) return "Map token rejected by Mapbox.";
  return "Failed to load map. Check your connection.";
}

/** Home's Live Map button. Sales never see the company-wide map; the route also denySalesRep. */
export function showPhoneLiveMapButton(isSalesRep: boolean): boolean {
  return !isSalesRep;
}
