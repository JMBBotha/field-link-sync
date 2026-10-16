import { useNavigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import AdminHome from "@/components/AdminHome";
import ClassicAdminHome from "@/components/classic/ClassicAdminHome";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import MapView from "@/components/MapView";
import OfferCards from "@/components/dispatch/OfferCards";
import { Button } from "@/components/ui/button";
import { useSalesRep } from "@/hooks/useSalesRep";
import V8RoleHome from "@/components/v8/V8RoleHome";
import { useV8Role } from "@/components/v8/V8Sidebar";

import { Map, ExternalLink, Maximize2, Minimize2, LayoutTemplate } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const AdminHomePage = () => {
  const navigate = useNavigate();
  const { isSalesRep } = useSalesRep();
  const { isClassic, toggle: toggleLayout } = useLayoutVersion();
  const v8Role = useV8Role();
  const HomeC = isClassic ? ClassicAdminHome : AdminHome;
  const [showCreateLead, setShowCreateLead] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      <div ref={pageRef} className="relative h-full min-h-0 flex flex-col bg-background">
        {/* Desktop map controls; mobile navigation already exposes these destinations. */}
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

        {/* Live map background */}
        <div className="relative flex-1 min-h-0">
          {/* Live map behind both layouts (Johan 13 Oct 12:55: restore it on New). New gets a slightly stronger wash so the v7 panels stay readable. */}
          <div className={isClassic ? "absolute inset-0 pointer-events-none opacity-70" : "absolute inset-0 pointer-events-none opacity-30"} aria-hidden="true">
            <MapView showAllAgents hideChromeControls hideStatusFilters />
          </div>
          <div className={isClassic ? "absolute inset-0 bg-background/40 pointer-events-none" : "absolute inset-0 bg-background/60 pointer-events-none"} aria-hidden="true" />

          {/* Dashboard content floating over the map */}
          <div className={isClassic ? "relative h-full overflow-y-auto p-3 pb-20 md:p-4 md:pb-20 lg:pb-4 space-y-3" : "relative h-full overflow-y-auto p-3 pb-20 md:p-4 md:pb-20 lg:pb-4 space-y-3"}>
            {/* Same-spot view switch on both layouts (Johan 13 Oct: no way back from Classic). */}
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={toggleLayout} data-testid="dashboard-layout-switch" className="gap-1.5 text-xs h-8 bg-card/90 backdrop-blur-sm shadow-sm">
                <LayoutTemplate className="h-3.5 w-3.5" />
                {isClassic ? "Switch to new view" : "Switch to classic view"}
              </Button>
            </div>
            {!isClassic && v8Role !== "tech" && <V8RoleHome role={v8Role} />}
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
