import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Menu, Sun, Moon, Search, Sparkle } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import NotificationBell from "@/components/notifications/NotificationBell";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import Footer from "@/components/Footer";

import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import IdleWarningModal from "@/components/IdleWarningModal";
import GlobalSearchDialog from "@/components/GlobalSearchDialog";
import NLCommandBar from "@/components/admin/NLCommandBar";

import { useIdleLogout } from "@/hooks/useIdleLogout";
import { WelcomeTourDialog } from "@/components/admin/WelcomeTourDialog";
import logo from "@/assets/logo.png";

const AdminLayout = () => {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"text" | "voice">("voice");


  const { session, user, loading: authLoading } = useAuth();
  const currentUserId = user?.id ?? "";

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { resolvedTheme, toggleTheme } = useTheme();
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
    "/admin/customers": "Clients",
    "/admin/jobs": "Jobs",
    "/admin/jobs/dispatch": "Jobs & Dispatch",
    "/admin/my-jobs": "My Jobs",
    "/admin/jobs-map": "Live Tracking",
    "/admin/dispatch": "Dispatch Board",
    "/admin/schedule": "Schedule",
    "/admin/quotes": "Quotes",
    "/admin/templates": "Templates",
    "/admin/invoices": "Invoices",
    "/admin/agreements": "Agreements",
    "/admin/catalog": "Product Catalog",
    "/admin/inventory": "Inventory",
    "/admin/flat-rate": "Flat Rate Book",
    "/admin/reports": "Reports",
    "/admin/reports/advanced": "Advanced Reports",
    "/admin/reports/aging": "Accounts Aging",
    "/admin/reports/sales-by-client": "Sales by Client",
    "/admin/reports/sales-by-product": "Sales by Product",
    "/admin/reports/vat": "VAT Summary",
    "/admin/analytics": "Analytics",
    "/admin/notifications": "Notifications",
    "/admin/audit": "Audit Log",
    "/admin/import": "CSV Import",
    "/admin/settings": "Settings",
    "/admin/team": "Team Management",
    "/admin/billing": "Billing & Subscription",
    "/admin/suppliers": "Supplier Database",
    "/admin/companies": "Company Management",
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

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!session || !user) return;
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session, user]);

  const checkAuth = async () => {
    try {
      if (!session || !user) { navigate("/login"); return; }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      if (!mountedRef.current) return;
      const userRoles = roles?.map(r => r.role) || [];
      const hasAdminAccess = userRoles.some(r => ["admin", "dispatcher", "viewer"].includes(r));
      if (!hasAdminAccess) {
        toast({ title: "Access Denied", description: "You don't have admin panel access", variant: "destructive" });
        navigate("/field");
        return;
      }
      if (!mountedRef.current) return;
      setIsAdmin(true);

      // If onboarding not completed, redirect to unified onboarding
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!mountedRef.current) return;
      if (!profile?.onboarding_completed) {
        navigate("/onboarding");
        return;
      }
    } catch (error: any) {
      console.error("Auth check error:", error);
      navigate("/login");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
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


  return (
    <div className="app-surface flex h-screen overflow-hidden">
      <AdminSidebar
        onCreateLead={() => setShowCreateLead(true)}
        onSignOut={handleSignOut}
        pendingRequestsCount={pendingRequestsCount}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 h-14 border-b flex items-center justify-between px-2 sm:px-4 gap-2 z-20 bg-primary dark:bg-gradient-to-r dark:from-[#070e1a] dark:via-[#153258]/90 dark:to-[#070e1a] border-[#006699] dark:border-[#153258]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden text-primary-foreground hover:bg-white/10 hover:text-primary-foreground shrink-0 h-9 w-9"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <img src={logo} alt="Logo" className="h-8 lg:hidden shrink-0" />
            <h1 className="text-base sm:text-lg font-bold text-primary-foreground truncate">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchOpen(true)}
              className="text-blue-100 hover:bg-white/10 hover:text-primary-foreground gap-1.5 hidden sm:flex"
            >
              <Search className="h-4 w-4" />
              <span className="text-xs">Search</span>
              <kbd className="ml-1 rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAssistantMode("voice");
                setAssistantOpen(true);
              }}
              className="text-blue-100 hover:bg-white/10 hover:text-primary-foreground gap-1.5"
              title="Talk to the operations assistant"
            >
              <Sparkle className="h-4 w-4" />
              <span className="text-xs hidden sm:inline">Ask Mandy</span>
            </Button>

            <NotificationBell />

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-blue-100 hover:bg-white/10 hover:text-primary-foreground h-9 w-9"
              title={resolvedTheme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {resolvedTheme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </header>


        {/* Sticky mobile search bar */}
        <div className="shrink-0 sm:hidden sticky top-0 z-10 border-b px-3 py-2 bg-primary dark:bg-gradient-to-r dark:from-[#070e1a] dark:via-[#153258]/90 dark:to-[#070e1a] border-[#006699] dark:border-[#153258]">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm text-blue-100 transition-colors hover:bg-white/20"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span>Search agents, leads, customers…</span>
          </button>
        </div>



        <main className="app-surface flex-1 overflow-auto pb-28 lg:pb-0">

          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="h-full"
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
        <AdminBottomNav onOpenMenu={() => setMobileMenuOpen(true)} />
      </div>


      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <NLCommandBar open={assistantOpen} onOpenChange={setAssistantOpen} initialMode={assistantMode} />

      <IdleWarningModal open={showWarning} secondsLeft={secondsLeft} onStayActive={stayActive} />
      {currentUserId && <WelcomeTourDialog userId={currentUserId} />}

    </div>
  );
};

export default AdminLayout;
