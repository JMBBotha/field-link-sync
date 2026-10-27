import planUrl from "@/assets/sitemaps/avec-plan.jpg";
import avec from "@/data/avecSitemap.json";
import { houseNum, type HouseStatus, type ProjectHouse } from "@/lib/projectTracker";

// Plot outlines traced from the AVEC phase plan photo (27 Oct). Crosses on the plan are
// shown as hatching only ("marked on plan") and never set a status.
const FILL: Record<HouseStatus, string> = { done: "#10b981", in_progress: "#f59e0b", due: "#ef4444", not_started: "#94a3b8" };

export default function SiteMap({ items, onOpen }: { items: { h: ProjectHouse; status: HouseStatus }[]; onOpen: (id: string) => void }) {
  const byNo = new Map(items.map((e) => [houseNum(e.h.house_no), e]));
  return (
    <div className="rounded-xl border bg-card p-2" data-testid="site-map">
      <svg viewBox={`0 0 ${avec.width} ${avec.height}`} className="w-full h-auto">
        <defs><pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#334155" strokeWidth="3" /></pattern></defs>
        <image href={planUrl} width={avec.width} height={avec.height} />
        {avec.plots.map((pl) => {
          const e = byNo.get(pl.n);
          const pts = pl.pts.map((p) => p.join(",")).join(" ");
          const color = e ? FILL[e.status] : "#cbd5e1";
          return (
            <g key={pl.n} onClick={() => e && onOpen(e.h.id)} className={e ? "cursor-pointer" : "opacity-60"}>
              <title>{`House ${pl.n}${pl.phase ? ` · plan phase ${pl.phase}` : ""}${pl.marked ? " · marked on plan" : ""}${e ? "" : " · not in project"}`}</title>
              <polygon points={pts} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={4} />
              {pl.marked && <polygon points={pts} fill="url(#hatch)" fillOpacity={0.35} pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">Colours come from live house status. Hatching = crossed on the plan (construction marking, not a status). Tap a plot to open the house.</p>
    </div>
  );
}
