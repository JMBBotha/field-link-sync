import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Plus, Users, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Menu, Settings, FileText, MessageSquare } from "lucide-react";
import MapView, { MapViewHandle } from "@/components/MapView";
import LeadsList from "@/components/LeadsList";
import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import AdminSettings from "@/components/AdminSettings";
import ServiceAgreements from "@/components/ServiceAgreements";
import AdminNotificationSettings from "@/components/AdminNotificationSettings";
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

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [completedPanelCollapsed, setCompletedPanelCollapsed] = useState(true);
  const [showCompletedFilter, setShowCompletedFilter] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "agreements" | "settings" | "notifications">("map");
  const mapRef = useRef<MapViewHandle>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

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
    } catch (error: any) {
      console.error("Auth check error:", error);
      navigate("/auth");
    } finally {
      setLoading(false);
    }
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
            variant={activeTab === "notifications" ? "secondary" : "ghost"} 
            onClick={() => setActiveTab(activeTab === "notifications" ? "map" : "notifications")} 
            className={activeTab === "notifications" ? "bg-white text-blue-600" : "text-white hover:bg-blue-500"}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Notifications
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

      {activeTab === "notifications" ? (
        <div className="flex-1 overflow-auto bg-background">
          <AdminNotificationSettings />
        </div>
      ) : activeTab === "agreements" ? (
        <div className="flex-1 overflow-auto bg-background">
          <ServiceAgreements />
        </div>
      ) : activeTab === "settings" ? (
        <div className="flex-1 overflow-auto bg-background">
          <AdminSettings />
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
                onLeadClick={(lat, lng, leadId) => mapRef.current?.panToLocationAndOpenPopup(lat, lng, leadId)}
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
                onLeadClick={(lat, lng, leadId) => mapRef.current?.panToLocationAndOpenPopup(lat, lng, leadId)}
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

      </div>
    </Layout>
  );
};

export default AdminDashboard;