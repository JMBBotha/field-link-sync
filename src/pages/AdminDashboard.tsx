import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Menu, Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import NotificationBell from "@/components/notifications/NotificationBell";
import InventoryList from "@/components/inventory/InventoryList";
import LowStockAlerts from "@/components/inventory/LowStockAlerts";
import MapView, { MapViewHandle } from "@/components/MapView";
import LeadsList from "@/components/LeadsList";
import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import AdminSettingsPage from "@/components/AdminSettingsPage";
import ServiceAgreements from "@/components/ServiceAgreements";
import AdminHome from "@/components/AdminHome";
import SetupWizard from "@/components/SetupWizard";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import AdminNotificationSettings from "@/components/AdminNotificationSettings";
import LeadDetailSheet from "@/components/LeadDetailSheet";
import Footer from "@/components/Footer";
import { List, Map, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import logo from "@/assets/logo.png";
import { useQuery } from "@tanstack/react-query";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import QuotesList from "@/components/quoting/QuotesList";
import AnalyticsDashboard from "@/components/analytics/AnalyticsDashboard";
import ReportBuilder from "@/components/reports/ReportBuilder";
import ScheduleCalendar from "@/components/scheduling/ScheduleCalendar";
import FlatRateBook from "@/components/flatrate/FlatRateBook";
import AuditLogViewer from "@/components/audit/AuditLogViewer";
import CSVImporter from "@/components/bulk/CSVImporter";
import { Upload } from "lucide-react";
import AdminSidebar from "@/components/admin/AdminSidebar";

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

const TAB_TITLES: Record<string, string> = {
  home: "Home",
  map: "Map View",
  schedule: "Schedule",
  quotes: "Quotes",
  proposals: "Proposals",
  invoices: "Invoices",
  agreements: "Agreements",
  inventory: "Inventory",
  flatrate: "Flat Rate Book",
  reports: "Reports",
  analytics: "Analytics",
  notifications: "Notifications",
  audit: "Audit Log",
  import: "CSV Import",
  settings: "Settings",
};

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [completedPanelCollapsed, setCompletedPanelCollapsed] = useState(true);
  const [showCompletedFilter, setShowCompletedFilter] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("home");
  const [importTarget, setImportTarget] = useState<"customers" | "inventory_items" | "flat_rate_items">("customers");
  const { needsSetup } = useCompanySettings();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const mapRef = useRef<MapViewHandle>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const { data: pendingRequestsCount = 0 } = useQuery({
    queryKey: ["pending-change-requests-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lead_change_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      const hasAdminRole = roles?.some(r => r.role === "admin");
      if (!hasAdminRole) {
        toast({ title: "Access Denied", description: "You don't have admin privileges", variant: "destructive" });
        navigate("/field");
        return;
      }
      setIsAdmin(true);
      setCurrentUserId(session.user.id);
    } catch (error: any) {
      console.error("Auth check error:", error);
      navigate("/auth");
    } finally {
      setLoading(false);
    }
  };

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailSheetOpen(true);
  };

  const handleAccept = async () => { toast({ title: "Info", description: "Use field agent view to accept leads" }); };
  const handleStart = async () => { toast({ title: "Info", description: "Use field agent view to start jobs" }); };
  const handleComplete = async () => { toast({ title: "Info", description: "Use field agent view to complete jobs" }); };
  const handleRelease = async () => { toast({ title: "Info", description: "Use field agent view to release leads" }); };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  if (needsSetup) {
    return <SetupWizard onComplete={() => window.location.reload()} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <AdminSidebar
        activeTab={activeTab as any}
        onTabChange={(tab) => setActiveTab(tab)}
        onCreateLead={() => setShowCreateLead(true)}
        onSignOut={handleSignOut}
        pendingRequestsCount={pendingRequestsCount}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header bar - minimal */}
        <header className="shrink-0 h-14 border-b flex items-center justify-between px-4" style={{ backgroundColor: '#0077B6', borderColor: '#006699' }}>
          {/* Left: mobile hamburger + logo */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden text-white hover:bg-white/20"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <img src={logo} alt="Logo" className="h-8 lg:hidden" />
            <h1 className="text-base font-semibold text-white">
              {TAB_TITLES[activeTab] || "Admin Dashboard"}
            </h1>
          </div>

          {/* Right: notifications, theme, avatar */}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-white hover:bg-white/20"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {activeTab === "home" ? (
            <div className="h-full overflow-auto bg-background">
              <ErrorBoundary>
                <AdminHome onNavigate={(tab) => setActiveTab(tab)} onCreateLead={() => setShowCreateLead(true)} />
              </ErrorBoundary>
            </div>
          ) : activeTab === "notifications" ? (
            <div className="h-full overflow-auto bg-background">
              <AdminNotificationSettings />
            </div>
          ) : activeTab === "quotes" ? (
            <div className="h-full overflow-auto bg-background">
              <QuotesList
                onCreateNew={() => navigate("/quotes")}
                onEditQuote={(id) => navigate("/quotes")}
              />
            </div>
          ) : activeTab === "proposals" ? (
            <div className="h-full overflow-auto bg-background">
              <div className="max-w-4xl mx-auto p-4 text-center py-8">
                <Button onClick={() => navigate("/proposals")}>Open Proposal Builder</Button>
              </div>
            </div>
          ) : activeTab === "invoices" ? (
            <div className="h-full overflow-auto bg-background">
              <div className="max-w-4xl mx-auto">
                <InvoiceListPage
                  onSelectInvoice={() => navigate("/invoices")}
                  onCreateInvoice={() => navigate("/invoices")}
                />
              </div>
            </div>
          ) : activeTab === "analytics" ? (
            <div className="h-full overflow-auto bg-background"><AnalyticsDashboard /></div>
          ) : activeTab === "reports" ? (
            <div className="h-full overflow-auto bg-background"><ReportBuilder /></div>
          ) : activeTab === "inventory" ? (
            <div className="h-full overflow-auto bg-background"><InventoryList /></div>
          ) : activeTab === "schedule" ? (
            <div className="h-full overflow-auto bg-background"><ScheduleCalendar /></div>
          ) : activeTab === "flatrate" ? (
            <div className="h-full overflow-auto bg-background"><FlatRateBook /></div>
          ) : activeTab === "agreements" ? (
            <div className="h-full overflow-auto bg-background"><ServiceAgreements /></div>
          ) : activeTab === "settings" ? (
            <div className="h-full overflow-auto bg-background"><AdminSettingsPage /></div>
          ) : activeTab === "audit" ? (
            <div className="h-full overflow-auto bg-background"><AuditLogViewer /></div>
          ) : activeTab === "import" ? (
            <div className="h-full overflow-auto bg-background p-4">
              <div className="max-w-3xl mx-auto space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Upload className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold">CSV Import</h2>
                </div>
                <div className="flex gap-2 mb-4">
                  {(["customers", "inventory_items", "flat_rate_items"] as const).map((t) => (
                    <Button
                      key={t}
                      variant={importTarget === t ? "default" : "outline"}
                      size="sm"
                      onClick={() => setImportTarget(t)}
                      className="capitalize text-xs"
                    >
                      {t.replace(/_/g, " ")}
                    </Button>
                  ))}
                </div>
                <CSVImporter
                  target={importTarget}
                  onComplete={() => setActiveTab("home")}
                  onClose={() => setActiveTab("home")}
                />
              </div>
            </div>
          ) : (
            /* Map view */
            <div className="h-full flex relative">
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
            </div>
          )}
        </main>

        <Footer />
      </div>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />

      <LeadDetailSheet
        lead={selectedLead}
        open={detailSheetOpen}
        onClose={() => setDetailSheetOpen(false)}
        onAccept={handleAccept}
        onStart={handleStart}
        onComplete={handleComplete}
        onRelease={handleRelease}
        currentUserId={currentUserId}
        loadingAction={null}
        onLeadUpdated={() => {}}
      />
    </div>
  );
};

export default AdminDashboard;
