import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Plus, Users, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Menu, Settings, FileText, MessageSquare, BarChart3, Package, ClipboardList, Home } from "lucide-react";
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
import Layout from "@/components/Layout";
import { List, Map } from "lucide-react";
import logo from "@/assets/logo.png";
import { LeadStatusFilter } from "@/components/StatusFilterButtons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import InvoiceDashboardWidget from "@/components/invoicing/InvoiceDashboardWidget";
import InvoiceListPage from "@/components/invoicing/InvoiceListPage";
import QuotesList from "@/components/quoting/QuotesList";
import AnalyticsDashboard from "@/components/analytics/AnalyticsDashboard";
import ReportBuilder from "@/components/reports/ReportBuilder";
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

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [completedPanelCollapsed, setCompletedPanelCollapsed] = useState(true);
  const [showCompletedFilter, setShowCompletedFilter] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "map" | "agreements" | "settings" | "notifications" | "invoices" | "quotes" | "proposals" | "analytics" | "inventory" | "reports">("home");
  const { needsSetup } = useCompanySettings();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const mapRef = useRef<MapViewHandle>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Query for pending change requests count
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
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      const hasAdminRole = roles?.some(r => r.role === "admin");
      
      if (!hasAdminRole) {
        toast({
          title: "Access Denied",
          description: "You don't have admin privileges",
          variant: "destructive",
        });
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

  // Stub handlers for LeadDetailSheet - admin can view but not perform field agent actions
  const handleAccept = async () => {
    toast({ title: "Info", description: "Use field agent view to accept leads" });
  };
  const handleStart = async () => {
    toast({ title: "Info", description: "Use field agent view to start jobs" });
  };
  const handleComplete = async () => {
    toast({ title: "Info", description: "Use field agent view to complete jobs" });
  };
  const handleRelease = async () => {
    toast({ title: "Info", description: "Use field agent view to release leads" });
  };

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

  if (!isAdmin) {
    return null;
  }

  if (needsSetup) {
    return <SetupWizard onComplete={() => window.location.reload()} />;
  }

  const footerLeftContent = (
    <Button
      variant={!leadsCollapsed ? "secondary" : "ghost"}
      size="sm"
      onClick={() => setLeadsCollapsed(!leadsCollapsed)}
      className={!leadsCollapsed ? "bg-white text-blue-600 hover:bg-blue-50 gap-2" : "text-white hover:bg-blue-500 gap-2"}
    >
      {!leadsCollapsed ? (
        <>
          <Map className="h-4 w-4" />
          <span className="hidden sm:inline">Show Map</span>
        </>
      ) : (
        <>
          <List className="h-4 w-4" />
          <span className="hidden sm:inline">Show Leads</span>
        </>
      )}
    </Button>
  );

  return (
    <Layout footerLeftContent={footerLeftContent}>
      <div className="flex flex-col h-screen">
      <header className="border-b px-4 md:px-6 py-3 md:py-4 flex items-center justify-between" style={{ backgroundColor: '#0077B6', borderColor: '#006699', color: '#FFFFFF' }}>
        <div className="flex items-center gap-2 md:gap-4">
          <img src={logo} alt="Be Cool Logo" className="h-12 md:h-[4.5rem]" />
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-xs md:text-sm text-blue-100 hidden sm:block">Monitor field operations in real-time</p>
          </div>
        </div>

        {/* Desktop navigation */}
        <div className="hidden md:flex gap-2">
          <Button 
            variant={activeTab === "home" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab("home")} 
            className={activeTab === "home" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <Home className="mr-2 h-4 w-4" />
            Home
          </Button>
          <Button 
            variant={activeTab === "map" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab("map")} 
            className={activeTab === "map" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <span className="mr-2">🗺️</span>
            Map
          </Button>
          <Button
            variant={activeTab === "notifications" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "notifications" ? "map" : "notifications")} 
            className={`relative ${activeTab === "notifications" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}`}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Notifications
            {pendingRequestsCount > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
              >
                {pendingRequestsCount > 99 ? "99+" : pendingRequestsCount}
              </Badge>
             )}
          </Button>
          <Button 
            variant={activeTab === "quotes" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "quotes" ? "map" : "quotes")} 
            className={activeTab === "quotes" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <FileText className="mr-2 h-4 w-4" />
            Quotes
          </Button>
          <Button 
            variant={activeTab === "invoices" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "invoices" ? "map" : "invoices")} 
            className={activeTab === "invoices" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <FileText className="mr-2 h-4 w-4" />
            Invoices
          </Button>
          <Button 
            variant={activeTab === "proposals" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "proposals" ? "map" : "proposals")} 
            className={activeTab === "proposals" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <FileText className="mr-2 h-4 w-4" />
            Proposals
          </Button>
          <Button 
            variant={activeTab === "analytics" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "analytics" ? "map" : "analytics")} 
            className={activeTab === "analytics" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </Button>
          <Button 
            variant={activeTab === "agreements" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "agreements" ? "map" : "agreements")} 
            className={activeTab === "agreements" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <FileText className="mr-2 h-4 w-4" />
            Agreements
          </Button>
          <Button 
            variant={activeTab === "inventory" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "inventory" ? "map" : "inventory")} 
            className={activeTab === "inventory" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <Package className="mr-2 h-4 w-4" />
            Inventory
          </Button>
          <Button 
            variant={activeTab === "reports" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "reports" ? "map" : "reports")} 
            className={activeTab === "reports" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Reports
          </Button>
          <NotificationBell />
          <Button 
            variant={activeTab === "settings" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "settings" ? "map" : "settings")} 
            className={activeTab === "settings" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button onClick={() => setShowCreateLead(true)} className="bg-white text-blue-600 hover:bg-blue-50">
            <Plus className="mr-2 h-4 w-4" />
            New Lead
          </Button>
          <Button variant="ghost" onClick={() => navigate("/field")} className="text-white hover:bg-blue-500">
            <Users className="mr-2 h-4 w-4" />
            Field Agent View
          </Button>
          <Button variant="ghost" onClick={handleSignOut} className="text-white hover:bg-blue-500">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>

        {/* Mobile hamburger menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="text-white hover:bg-blue-500">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 bg-[#0077B6] border-[#006699]">
            <SheetHeader>
              <SheetTitle className="text-white text-left">Menu</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 mt-6">
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "quotes" ? "map" : "quotes");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "quotes" ? "secondary" : "ghost"}
                className={activeTab === "quotes" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                Quotes
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "invoices" ? "map" : "invoices");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "invoices" ? "secondary" : "ghost"}
                className={activeTab === "invoices" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                Invoices
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "proposals" ? "map" : "proposals");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "proposals" ? "secondary" : "ghost"}
                className={activeTab === "proposals" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                Proposals
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "agreements" ? "map" : "agreements");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "agreements" ? "secondary" : "ghost"}
                className={activeTab === "agreements" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                Service Agreements
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "analytics" ? "map" : "analytics");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "analytics" ? "secondary" : "ghost"}
                className={activeTab === "analytics" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Analytics
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "inventory" ? "map" : "inventory");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "inventory" ? "secondary" : "ghost"}
                className={activeTab === "inventory" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <Package className="mr-2 h-4 w-4" />
                Inventory
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "reports" ? "map" : "reports");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "reports" ? "secondary" : "ghost"}
                className={activeTab === "reports" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <ClipboardList className="mr-2 h-4 w-4" />
                Reports
              </Button>
              <Button 
                onClick={() => {
                  setActiveTab(activeTab === "settings" ? "map" : "settings");
                  setMobileMenuOpen(false);
                }} 
                variant={activeTab === "settings" ? "secondary" : "ghost"}
                className={activeTab === "settings" 
                  ? "bg-white text-blue-600 justify-start" 
                  : "text-white hover:bg-blue-500 justify-start"
                }
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
              <Button 
                onClick={() => {
                  setShowCreateLead(true);
                  setMobileMenuOpen(false);
                }} 
                className="bg-white text-blue-600 hover:bg-blue-50 justify-start"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Lead
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => {
                  navigate("/field");
                  setMobileMenuOpen(false);
                }} 
                className="text-white hover:bg-blue-500 justify-start"
              >
                <Users className="mr-2 h-4 w-4" />
                Field Agent View
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => {
                  handleSignOut();
                  setMobileMenuOpen(false);
                }} 
                className="text-white hover:bg-blue-500 justify-start"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {activeTab === "home" ? (
        <div className="flex-1 overflow-auto bg-background">
          <ErrorBoundary>
            <AdminHome onNavigate={(tab) => setActiveTab(tab as any)} onCreateLead={() => setShowCreateLead(true)} />
          </ErrorBoundary>
        </div>
      ) : activeTab === "notifications" ? (
        <div className="flex-1 overflow-auto bg-background">
          <AdminNotificationSettings />
        </div>
      ) : activeTab === "quotes" ? (
        <div className="flex-1 overflow-auto bg-background">
          <QuotesList
            onCreateNew={() => navigate("/quotes")}
            onEditQuote={(id) => navigate("/quotes")}
          />
        </div>
      ) : activeTab === "proposals" ? (
        <div className="flex-1 overflow-auto bg-background">
          <div className="max-w-4xl mx-auto p-4 text-center py-8">
            <Button onClick={() => navigate("/proposals")}>Open Proposal Builder</Button>
          </div>
        </div>
      ) : activeTab === "invoices" ? (
        <div className="flex-1 overflow-auto bg-background">
          <div className="max-w-4xl mx-auto">
            <InvoiceListPage
              onSelectInvoice={(inv) => {
                navigate("/invoices");
              }}
              onCreateInvoice={() => {
                navigate("/invoices");
              }}
            />
          </div>
        </div>
      ) : activeTab === "analytics" ? (
        <div className="flex-1 overflow-auto bg-background">
          <AnalyticsDashboard />
        </div>
      ) : activeTab === "reports" ? (
        <div className="flex-1 overflow-auto bg-background">
          <ReportBuilder />
        </div>
      ) : activeTab === "inventory" ? (
        <div className="flex-1 overflow-auto bg-background">
          <InventoryList />
        </div>
      ) : activeTab === "agreements" ? (
        <div className="flex-1 overflow-auto bg-background">
          <ServiceAgreements />
        </div>
      ) : activeTab === "settings" ? (
        <div className="flex-1 overflow-auto bg-background">
          <AdminSettingsPage />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden relative">
          {/* Full-width map */}
          <div className="absolute inset-0">
            <MapView 
              ref={mapRef} 
              onStatusFiltersChange={(filters) => {
                const hasCompleted = filters.has("completed");
                setShowCompletedFilter(hasCompleted);
                if (hasCompleted) {
                  setCompletedPanelCollapsed(false);
                } else {
                  setCompletedPanelCollapsed(true);
                }
              }}
              onLeadClick={handleLeadClick}
            />
          </div>
          
          {/* Left side - Completed leads panel toggle button */}
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

          {/* Floating completed leads panel overlay (left side) */}
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
                  console.log('[AdminDashboard] CompletedPanel onLeadClick:', { lat, lng, leadId, hasMapRef: !!mapRef.current });
                  if (mapRef.current) {
                    mapRef.current.panToLocationAndOpenPopup(lat, lng, leadId);
                  }
                }}
                onPanelClose={() => setCompletedPanelCollapsed(true)}
              />
            )}
          </div>

          {/* Right side - Desktop collapse toggle button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLeadsCollapsed(!leadsCollapsed)}
            className="hidden md:flex absolute top-4 z-20 bg-white/80 backdrop-blur-md shadow-md hover:bg-white/90 rounded-md border transition-all duration-300"
            style={{ right: leadsCollapsed ? '1rem' : 'calc(24rem + 1rem)' }}
          >
            {leadsCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>

          {/* Floating leads panel overlay (right side) */}
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
                  console.log('[AdminDashboard] onLeadClick called:', { lat, lng, leadId, hasMapRef: !!mapRef.current });
                  if (mapRef.current) {
                    console.log('[AdminDashboard] Calling panToLocationAndOpenPopup');
                    mapRef.current.panToLocationAndOpenPopup(lat, lng, leadId);
                  } else {
                    console.warn('[AdminDashboard] mapRef.current is null');
                  }
                }}
                onPanelClose={() => setLeadsCollapsed(true)}
              />
            )}
          </div>
        </div>
      )}

      <CreateLeadDialog
        open={showCreateLead}
        onOpenChange={setShowCreateLead}
      />

      {/* Lead Detail Sheet for viewing lead details and managing photos */}
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
        onLeadUpdated={() => {
          // Optionally refresh data
        }}
      />

      </div>
    </Layout>
  );
};

export default AdminDashboard;