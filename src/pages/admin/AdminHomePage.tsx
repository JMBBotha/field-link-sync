import { useNavigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import AdminHome from "@/components/AdminHome";
import ClassicAdminHome from "@/components/classic/ClassicAdminHome";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import MapView, { type MapViewHandle } from "@/components/MapView";
import OfferCards from "@/components/dispatch/OfferCards";
import { Button } from "@/components/ui/button";
import { useSalesRep } from "@/hooks/useSalesRep";
import FieldPresenceBoard from "@/components/admin/FieldPresenceBoard";
import SalesMyJobs from "@/components/jobs/SalesMyJobs";
import V8RoleHome from "@/components/v8/V8RoleHome";
import NextStepsPanel from "@/components/sales/NextStepsPanel";
import HomeFocus from "@/components/home/HomeFocus";
import RequestsTodayStrip from "@/components/requests/RequestsTodayStrip";
import { useV8Role } from "@/components/v8/V8Sidebar";

import { Map, ExternalLink, Maximize2, Minimize2, LayoutTemplate } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { homeMapNotice, homeOverlayClass, mapHeroShellClass, mapHeroStageClass, showPhoneLiveMapButton, type MapAvailability } from "@/lib/phoneMapFrame";

const AdminHomePage = () => {
  const navigate = useNavigate();
  const { isSalesRep } = useSalesRep();
  const { isClassic, toggle: toggleLayout } = useLayoutVersion();
  const v8Role = useV8Role();
  const HomeC = isClassic ? ClassicAdminHome : AdminHome;
  const [showCreateLead, setShowCreateLead] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapViewHandle>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapAvailability, setMapAvailability] = useState<MapAvailability>({ state: "loading", message: "Connecting to Mapbox…" });
  const onMapAvailability = useCallback((s: MapAvailability) => setMapAvailability(s), []);
  const mapNotice = homeMapNotice(mapAvailability);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await pageRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      console.error("Fullscreen error:", e);
    }
  };

  const tabToRoute: Record<string, string> = {
    home: "/admin",
    map: "/admin/map",
    dispatch: "/admin/dispatch",
    schedule: "/admin/schedule",
    quotes: "/admin/quotes",
    proposals: "/admin/templates",
    invoices: "/admin/invoices",
    agreements: "/admin/agreements",
    inventory: "/admin/inventory",
    reports: "/admin/reports",
    analytics: "/admin/analytics",
    notifications: "/admin/notifications",
    audit: "/admin/audit",
    import: "/admin/import",
    settings: "/admin/settings",
  };

  return (
    <ErrorBoundary>
      <div ref={pageRef} className={`${mapHeroShellClass} bg-gradient-to-b from-[#F3FAFE] to-[#E8F6FE] dark:from-background dark:to-background`}>
        {/* Desktop map controls. Phones get a Live Map button in the overlay (the tab bar stays at four). */}
        <div className="hidden lg:flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 border-b bg-card/80 backdrop-blur-sm z-20">
          <span aria-current="page" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 h-8 text-xs font-medium">
            <Map className="h-3.5 w-3.5" />
            Dashboard
          </span>
          {!isSalesRep && (
            <Button size="sm" variant="ghost" onClick={() => navigate("/admin/map")} className="gap-1.5 text-xs h-8">
              <Map className="h-3.5 w-3.5" />
              Live Map
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggleFullscreen} className="gap-1.5 text-xs h-8">
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open("/admin", "_blank", "width=1400,height=900,noopener,noreferrer")}
            className="gap-1.5 text-xs h-8"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            New Window
          </Button>
        </div>

        {/* Live map background. No opacity and no backdrop-filter on this layer: both leave the iOS canvas blank. */}
        <div className={mapHeroStageClass}>
          {/* Live map behind both layouts (Johan 13 Oct 12:55: restore it on New). A flat wash keeps the panels readable without hiding a failed map. */}
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
            <MapView ref={mapRef} showAllAgents hideChromeControls hideStatusFilters onAvailabilityChange={onMapAvailability} />
          </div>
          <div
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{ background: `hsl(var(--background) / ${isClassic ? 0.35 : 0.55})` }}
            aria-hidden="true"
          />

          {/* Dashboard content floating over the map. Absolute, not h-full: iOS clips h-full + overflow to 0. */}
          <div className={homeOverlayClass} data-testid="home-dashboard">
            {/* Same-spot view switch on both layouts (Johan 13 Oct: no way back from Classic). */}
            {/* Hidden on phones (Johan 29 Oct): desktop keeps the switch. */}
            <div className="hidden md:flex justify-end">
              <Button size="sm" variant="outline" onClick={toggleLayout} data-testid="dashboard-layout-switch" className="gap-1.5 text-xs h-8 bg-card/90 backdrop-blur-sm shadow-sm">
                <LayoutTemplate className="h-3.5 w-3.5" />
                {isClassic ? "Switch to new view" : "Switch to classic view"}
              </Button>
            </div>
            {showPhoneLiveMapButton(isSalesRep) && (
              <div className="flex lg:hidden">
                <Button size="sm" variant="outline" onClick={() => navigate("/admin/map")} data-testid="home-open-live-map" className="h-11 gap-1.5 bg-card text-sm shadow-sm">
                  <Map className="h-3.5 w-3.5" />
                  Live Map
                </Button>
              </div>
            )}
            {mapNotice && (
              <div
                role="status"
                data-testid="home-map-notice"
                data-tone={mapNotice.tone}
                className={mapNotice.tone === "error"
                  ? "flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm"
                  : "rounded-xl border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm"}
              >
                <span>{mapNotice.text}</span>
                {mapNotice.tone === "error" && (
                  <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => mapRef.current?.retry()}>Retry</Button>
                )}
              </div>
            )}
            {/* Next steps to-do on top for sales + admin (Johan 31 Oct 2026). */}
            {/* Admin home polish (Johan 2 Nov 17:51): next step, orange invoices waiting, requests today, then in order. */}
            {v8Role !== "tech" && <HomeFocus requests={<RequestsTodayStrip blue />} />}
            {!isClassic && v8Role !== "tech" && <V8RoleHome role={v8Role} hideRequests />}
            {v8Role !== "tech" && (
              <details className="v7-solid rounded-2xl border bg-card p-2" data-testid="home-all-next-steps"><summary className="cursor-pointer px-2 py-1 text-sm font-semibold">All next steps (filter, snooze)</summary>
                <NextStepsPanel className="mt-2 border-0 p-1" /></details>
            )}
            {!isSalesRep && <FieldPresenceBoard />}
            {isSalesRep && <SalesMyJobs />}
            <OfferCards />
            {!isClassic && v8Role !== "tech" ? (
            <details className="v7-solid rounded-2xl border bg-card p-2" data-testid="v8-home-details"><summary className="cursor-pointer px-2 py-1 text-sm font-semibold">More details (gauges, funnel, comparisons)</summary>
            <div className="space-y-3 pt-2"><HomeC onNavigate={(tab) => navigate(tabToRoute[tab] || "/admin")} onCreateLead={() => setShowCreateLead(true)} /></div></details>
            ) : (
            <div className={isClassic ? undefined : "v7-solid space-y-3"}>
            <HomeC
              onNavigate={(tab) => navigate(tabToRoute[tab] || "/admin")}
              onCreateLead={() => setShowCreateLead(true)}
            />
            </div>
            )}
          </div>

        </div>
      </div>
      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
    </ErrorBoundary>
  );
};

export default AdminHomePage;
