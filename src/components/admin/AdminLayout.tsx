import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Menu, Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import NotificationBell from "@/components/notifications/NotificationBell";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import SetupWizard from "@/components/SetupWizard";
import Footer from "@/components/Footer";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin/AdminSidebar";
import OnboardingFlow from "@/components/OnboardingFlow";
import logo from "@/assets/logo.png";

const AdminLayout = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const { needsSetup } = useCompanySettings();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const pageTitles: Record<string, string> = {
    "/admin": "Home",
    "/admin/map": "Map",
    "/admin/schedule": "Schedule",
    "/admin/quotes": "Quotes",
    "/admin/proposals": "Proposals",
    "/admin/invoices": "Invoices",
    "/admin/agreements": "Agreements",
    "/admin/catalog": "Product Catalog",
    "/admin/inventory": "Inventory",
    "/admin/flat-rate": "Flat Rate Book",
    "/admin/reports": "Reports",
    "/admin/analytics": "Analytics",
    "/admin/notifications": "Notifications",
    "/admin/audit": "Audit Log",
    "/admin/import": "CSV Import",
    "/admin/settings": "Settings",
  };
  const pageTitle = pageTitles[location.pathname] || "Admin Dashboard";

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

      // Check onboarding status
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!profile?.onboarding_completed) {
        setShowOnboarding(true);
      }
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

  if (!isAdmin) return null;

  if (needsSetup) {
    return <SetupWizard onComplete={() => window.location.reload()} />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        onCreateLead={() => setShowCreateLead(true)}
        onSignOut={handleSignOut}
        pendingRequestsCount={pendingRequestsCount}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 h-14 border-b flex items-center justify-between px-4" style={{ backgroundColor: '#0077B6', borderColor: '#006699' }}>
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
            <h1 className="text-base font-semibold text-white">{pageTitle}</h1>
          </div>

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

        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>

        <Footer />
      </div>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />

      {showOnboarding && currentUserId && (
        <OnboardingFlow
          userId={currentUserId}
          userRole="admin"
          onComplete={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
};

export default AdminLayout;
