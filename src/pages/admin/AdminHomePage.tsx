import { useNavigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import AdminHome from "@/components/AdminHome";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import MapView from "@/components/MapView";
import { Button } from "@/components/ui/button";
import { Map, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const AdminHomePage = () => {
  const navigate = useNavigate();
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
    flatrate: "/admin/flat-rate",
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
        {/* Map-page style toolbar */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-card/80 backdrop-blur-sm z-20">
          <Button size="sm" variant="default" className="gap-1.5 text-xs h-8">
            <Map className="h-3.5 w-3.5" />
            Dashboard
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("/admin/map")} className="gap-1.5 text-xs h-8">
            <Map className="h-3.5 w-3.5" />
            Live Map
          </Button>
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
          <div className="absolute inset-0 pointer-events-none opacity-70" aria-hidden="true">
            <MapView showAllAgents hideChromeControls hideStatusFilters />
          </div>
          <div className="absolute inset-0 bg-background/40 pointer-events-none" aria-hidden="true" />

          {/* Dashboard content floating over the map */}
          <div className="relative h-full overflow-y-auto p-3 md:p-4">
            <AdminHome
              onNavigate={(tab) => navigate(tabToRoute[tab] || "/admin")}
              onCreateLead={() => setShowCreateLead(true)}
            />
          </div>
        </div>
      </div>
      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
    </ErrorBoundary>
  );
};

export default AdminHomePage;
