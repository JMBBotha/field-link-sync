import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Map, Flame } from "lucide-react";
import MapView, { MapViewHandle } from "@/components/MapView";
import LeadsList from "@/components/LeadsList";
import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import LeadDetailSheet from "@/components/LeadDetailSheet";
import LeadHeatmap from "@/components/map/LeadHeatmap";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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

type TabView = "map" | "heatmap";

const AdminMapPage = () => {
  const [activeTab, setActiveTab] = useState<TabView>("map");
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [completedPanelCollapsed, setCompletedPanelCollapsed] = useState(true);
  const [showCompletedFilter, setShowCompletedFilter] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const mapRef = useRef<MapViewHandle>(null);
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setCurrentUserId(session.user.id);
    });
  }, []);

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailSheetOpen(true);
  };

  const infoAction = async () => { toast({ title: "Info", description: "Use field agent view for this action" }); };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab switcher */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b bg-card/80 backdrop-blur-sm z-20">
        <Button
          size="sm"
          variant={activeTab === "map" ? "default" : "ghost"}
          onClick={() => setActiveTab("map")}
          className="gap-1.5 text-xs h-8"
        >
          <Map className="h-3.5 w-3.5" />
          Live Map
        </Button>
        <Button
          size="sm"
          variant={activeTab === "heatmap" ? "default" : "ghost"}
          onClick={() => setActiveTab("heatmap")}
          className="gap-1.5 text-xs h-8"
        >
          <Flame className="h-3.5 w-3.5" />
          Density Heatmap
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {activeTab === "map" && (
          <>
            <div className="absolute inset-0">
              <MapView
                ref={mapRef}
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
                className="hidden md:flex absolute top-4 z-20 bg-white/80 backdrop-blur-md shadow-md hover:bg-white/90 rounded-md border transition-all duration-300"
                style={{ left: completedPanelCollapsed ? '1rem' : 'calc(24rem + 1rem)' }}
              >
                {completedPanelCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            )}

            <div
              className={`absolute top-0 left-0 h-full z-10 overflow-y-auto backdrop-blur-md border-r shadow-xl transition-all duration-300 ease-out ${
                completedPanelCollapsed || !showCompletedFilter
                  ? 'w-0 opacity-0 pointer-events-none translate-x-[-100%]'
                  : 'w-full md:w-96 opacity-100 translate-x-0'
              }`}
              style={{ background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(34, 197, 94, 0.08) 100%)' }}
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
              className="hidden md:flex absolute top-4 z-20 bg-white/80 backdrop-blur-md shadow-md hover:bg-white/90 rounded-md border transition-all duration-300"
              style={{ right: leadsCollapsed ? '1rem' : 'calc(24rem + 1rem)' }}
            >
              {leadsCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
            </Button>

            <div
              className={`absolute top-0 right-0 h-full z-10 overflow-y-auto backdrop-blur-md border-l shadow-xl transition-all duration-300 ease-out ${
                leadsCollapsed
                  ? 'w-0 opacity-0 pointer-events-none translate-x-[100%]'
                  : 'w-full md:w-96 opacity-100 translate-x-0'
              }`}
              style={{ background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(34, 197, 94, 0.08) 100%)' }}
            >
              {!leadsCollapsed && (
                <LeadsList
                  onLeadClick={(lat, lng, leadId) => {
                    if (mapRef.current) mapRef.current.panToLocationAndOpenPopup(lat, lng, leadId);
                  }}
                  onPanelClose={() => setLeadsCollapsed(true)}
                />
              )}
            </div>
          </>
        )}

        {activeTab === "heatmap" && (
          <div className="absolute inset-0">
            <LeadHeatmap />
          </div>
        )}
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
