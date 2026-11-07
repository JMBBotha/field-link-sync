import "./roleHome.css";
import type { ReactNode } from "react";
import MapView from "@/components/MapView";
import { homeOverlayClass, mapHeroShellClass, mapHeroStageClass } from "@/lib/phoneMapFrame";

/** Streets only. Markers and client panels stay off this layer. */
export default function RoleMapFrame({
  children,
  fill = false,
  map = true,
}: {
  children: ReactNode;
  /** True inside the iPhone-safe flex frame (admin home, v8 field shell). */
  fill?: boolean;
  /** Harness shots can skip Mapbox and keep the streets wash. */
  map?: boolean;
}) {
  const shell = fill ? mapHeroShellClass : "relative min-h-[100dvh]";
  const stage = fill ? `${mapHeroStageClass} rh-stage-fallback` : "relative min-h-[100dvh] rh-stage-fallback";
  return (
    <div className={shell} data-testid="role-map-frame">
      <div className={stage}>
        {map && (
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <MapView geographyOnly hideChromeControls hideStatusFilters />
          </div>
        )}
        <div className={fill ? homeOverlayClass : "relative z-10 space-y-3 p-3 pb-28"}>{children}</div>
      </div>
    </div>
  );
}
