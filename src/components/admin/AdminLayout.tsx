import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Menu, Sun, Moon, Search } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import NotificationBell from "@/components/notifications/NotificationBell";
import SubscriptionBadge from "@/components/subscription/SubscriptionBadge";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import SetupWizard from "@/components/SetupWizard";
import Footer from "@/components/Footer";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin/AdminSidebar";
import OnboardingFlow from "@/components/OnboardingFlow";
import IdleWarningModal from "@/components/IdleWarningModal";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import logo from "@/assets/logo.png";

const AdminLayout = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { needsSetup } = useCompanySettings();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { showWarning, secondsLeft, stayActive } = useIdleLogout();

  // Global Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const pageTitles: Record<string, string> = {
    "/admin": "Home",
    "/admin/map": "Map",
    "/admin/dispatch": "Dispatch Board",
    "/admin/schedule": "Schedule",
    "/admin/quotes": "Quotes",
    "/admin/proposals": "Proposals",
    "/admin/invoices": "Invoices",
    "/admin/agreements": "Agreements",
    "/admin/catalog": "Product Catalog",
    "/admin/inventory": "Inventory",
    "/admin/flat-rate": "Flat Rate Book",
    "/admin/reports": "Reports",
    "/admin/reports/advanced": "Advanced Reports",
    "/admin/analytics": "Analytics",
    "/admin/notifications": "Notifications",
    "/admin/audit": "Audit Log",
    "/admin/import": "CSV Import",
    "/admin/settings": "Settings",
    "/admin/team": "Team Management",
    "/admin/billing": "Billing & Subscription",
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
      const userRoles = roles?.map(r => r.role) || [];
      const hasAdminAccess = userRoles.some(r => ["admin", "dispatcher", "viewer"].includes(r));
      if (!hasAdminAccess) {
        toast({ title: "Access Denied", description: "You don't have admin panel access", variant: "destructive" });
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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/40 animate-pulse" />
          <p className="text-sm text-muted-foreground animate-fade-in">Loading...</p>
        </div>
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
        <header className="shrink-0 h-14 border-b flex items-center justify-between px-4 bg-[#0077B6] dark:bg-gradient-to-r dark:from-[#070e1a] dark:via-[#183a66] dark:to-[#070e1a] border-[#006699] dark:border-[#153258]">
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

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOpen(true)}
              className="text-white/80 hover:text-white hover:bg-white/20 gap-1.5 hidden sm:flex"
            >
              <Search className="h-4 w-4" />
              <span className="text-xs">Search</span>
              <kbd className="ml-1 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              className="text-white hover:bg-white/20 sm:hidden"
            >
              <Search className="h-4 w-4" />
            </Button>
            <SubscriptionBadge />
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

        {/* Sticky mobile search bar */}
        <div className="shrink-0 sm:hidden sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm px-3 py-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span>Search agents, leads, customers…</span>
          </button>
        </div>

        <main className="flex-1 overflow-auto bg-background dark:bg-gradient-to-br dark:from-[#070e1a] dark:via-[#132f52]/40 dark:to-[#0b1a2e]">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        <Footer />
      </div>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <IdleWarningModal open={showWarning} secondsLeft={secondsLeft} onStayActive={stayActive} />

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
