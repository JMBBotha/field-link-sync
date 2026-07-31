import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Map, LocateFixed, Maximize2, Minimize2, ExternalLink, Layers } from "lucide-react";

import MapView, { MapViewHandle, MapStatusState } from "@/components/MapView";
import StatusFilterButtons, { LeadStatusFilter } from "@/components/StatusFilterButtons";
import BusinessSearch from "@/components/map/BusinessSearch";
import LeadsList from "@/components/LeadsList";
import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import LeadDetailSheet from "@/components/LeadDetailSheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
}

const AdminMapPage = () => {
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [completedPanelCollapsed, setCompletedPanelCollapsed] = useState(true);
  const [showCompletedFilter, setShowCompletedFilter] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const { user } = useAuth();
  const currentUserId = user?.id;
  const mapRef = useRef<MapViewHandle>(null);
  const { toast } = useToast();
  const pageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [trafficEnabled, setTrafficEnabledState] = useState(false);
  const [statusState, setStatusState] = useState<MapStatusState>({
    filters: new Set<LeadStatusFilter>(["pending", "accepted", "in_progress"]),
    counts: { pending: 0, accepted: 0, in_progress: 0, completed: 0 },
  });

  const handleStatusStateChange = useCallback((s: MapStatusState) => setStatusState(s), []);
  const handleStatusToggle = useCallback(
    (status: LeadStatusFilter) => mapRef.current?.toggleStatusFilter(status),
    []
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await pageRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error("Fullscreen error:", e);
    }
  };

  const openInNewWindow = () => {
    window.open("/admin/map", "_blank", "width=1400,height=900,noopener,noreferrer");
  };

  const handleTrafficToggle = (v: boolean) => {
    setTrafficEnabledState(v);
    mapRef.current?.setTrafficEnabled(v);
  };


  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailSheetOpen(true);
  };

  const infoAction = async () => { toast({ title: "Info", description: "Use field agent view for this action" }); };

  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Unavailable", description: "Geolocation is not supported in this browser", variant: "destructive" });
      return;
    }
    toast({ title: "Locating…", description: "Centering map on your current location" });

    const onSuccess = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      mapRef.current?.panToLocation(latitude, longitude);
    };

    // First try high accuracy (GPS). If it times out or fails, fall back to
    // low-accuracy (IP/WiFi) with a longer timeout and a cached fix allowed.
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      () => {
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          (err) => {
            const msg = err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Enable it in your browser settings."
              : err.code === err.POSITION_UNAVAILABLE
                ? "Your device couldn't determine a location right now."
                : err.message || "Unable to get your location";
            toast({ title: "Location failed", description: msg, variant: "destructive" });
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 5 * 60 * 1000 }
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60 * 1000 }
    );
  };

  return (
    <div ref={pageRef} className="h-full flex flex-col min-h-0 bg-background">
      {/* Tab switcher */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-card/80 backdrop-blur-sm z-20">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 text-xs h-8"
          >
            <Map className="h-3.5 w-3.5" />
            Live Map
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleMyLocation}
            className="gap-1.5 text-xs h-8"
          >
            <LocateFixed className="h-3.5 w-3.5" />
            My Location
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="gap-1.5 text-xs h-8"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={openInNewWindow}
            className="gap-1.5 text-xs h-8"
            title="Open map in new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            New Window
          </Button>
          <div className="flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-accent/50">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Traffic</span>
            <Switch checked={trafficEnabled} onCheckedChange={handleTrafficToggle} className="scale-75" />
          </div>
        </div>
        {/* Status pills — inline on desktop, second scrollable row on small screens */}
        <div className="order-last w-full min-w-0 overflow-x-auto scrollbar-hide lg:order-none lg:w-auto lg:overflow-visible">
          <StatusFilterButtons
            className="w-max flex-nowrap gap-1.5 sm:gap-2 px-1.5 py-1"
            activeFilters={statusState.filters}
            counts={statusState.counts}
            onToggle={handleStatusToggle}
          />
        </div>
      </div>




      {/* Content */}
      <div className="flex-1 relative">
        <>
          <div className="absolute inset-0">
            <MapView
              ref={mapRef}
              showAllAgents={true}
              hideChromeControls={true}
              hideStatusFilters={true}
              onStatusStateChange={handleStatusStateChange}
              onStatusFiltersChange={(filters) => {
                const hasCompleted = filters.has("completed");
                setShowCompletedFilter(hasCompleted);
                if (hasCompleted) setCompletedPanelCollapsed(false);
                else setCompletedPanelCollapsed(true);
              }}

              onLeadClick={handleLeadClick}
            />
          </div>

          {showCompletedFilter && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCompletedPanelCollapsed(!completedPanelCollapsed)}
              className={`flex absolute top-4 z-20 bg-white/80 backdrop-blur-md shadow-md hover:bg-white/90 rounded-md border transition-all duration-300 ${
                completedPanelCollapsed ? 'left-2' : 'left-[calc(min(72vw,22rem)+0.5rem)] sm:left-[calc(20rem+0.5rem)] md:left-[calc(24rem+0.5rem)]'
              }`}
            >
              {completedPanelCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          )}

          <div
            className={`absolute top-0 left-0 h-full z-10 overflow-y-auto backdrop-blur-md border-r shadow-xl transition-all duration-300 ease-out ${
              completedPanelCollapsed || !showCompletedFilter
                ? 'w-0 opacity-0 pointer-events-none translate-x-[-100%]'
                : 'w-[72vw] max-w-[22rem] sm:w-80 md:w-96 opacity-100 translate-x-0'
            }`}
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(34, 197, 94, 0.10) 100%)' }}
          >
            {!completedPanelCollapsed && showCompletedFilter && (
              <CompletedLeadsPanel
                isVisible={!completedPanelCollapsed && showCompletedFilter}
                onLeadClick={(lat, lng, leadId) => {
                  if (mapRef.current) mapRef.current.panToLocationAndOpenPopup(lat, lng, leadId);
                }}
                onPanelClose={() => setCompletedPanelCollapsed(true)}
              />
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLeadsCollapsed(!leadsCollapsed)}
            className={`flex absolute top-4 z-20 bg-white/80 backdrop-blur-md shadow-md hover:bg-white/90 rounded-md border transition-all duration-300 ${
              leadsCollapsed ? 'right-2' : 'right-[calc(min(72vw,22rem)+0.5rem)] sm:right-[calc(20rem+0.5rem)] md:right-[calc(24rem+0.5rem)]'
            }`}
          >
            {leadsCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>

          <div
            className={`absolute top-0 right-0 h-full z-10 overflow-y-auto backdrop-blur-md border-l shadow-xl transition-all duration-300 ease-out ${
              leadsCollapsed
                ? 'w-0 opacity-0 pointer-events-none translate-x-[100%]'
                : 'w-[72vw] max-w-[22rem] sm:w-80 md:w-96 opacity-100 translate-x-0'
            }`}
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(34, 197, 94, 0.10) 100%)' }}
          >
            {!leadsCollapsed && (
              <LeadsList
                headerSlot={
                  <BusinessSearch
                    className="relative w-full"
                    getToken={() => mapRef.current?.getMapboxToken() ?? null}
                    onSelect={(lat, lng, name, address) => {
                      mapRef.current?.showSearchResult(lat, lng, name, address);
                    }}
                  />
                }
                onLeadClick={(lat, lng, leadId) => {
                  if (mapRef.current) mapRef.current.panToLocationAndOpenPopup(lat, lng, leadId);
                }}
                onPanelClose={() => setLeadsCollapsed(true)}
              />
            )}
          </div>
        </>
      </div>


      <LeadDetailSheet
        lead={selectedLead}
        open={detailSheetOpen}
        onClose={() => setDetailSheetOpen(false)}
        onAccept={infoAction}
        onStart={infoAction}
        onComplete={infoAction}
        onRelease={infoAction}
        currentUserId={currentUserId}
        loadingAction={null}
        onLeadUpdated={() => {}}
      />
    </div>
  );
};

export default AdminMapPage;
