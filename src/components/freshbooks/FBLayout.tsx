import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  LayoutDashboard, FileText, FileBarChart, Receipt,
  Clock, Users, BarChart3, CreditCard, FolderKanban,
  LogOut, ChevronLeft, Menu, Search, Bell, Moon, Sun
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import logo from "@/assets/logo.png";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "dashboard" },
  { label: "Invoices", icon: FileText, path: "invoices" },
  { label: "Estimates", icon: FileBarChart, path: "estimates" },
  { label: "Expenses", icon: Receipt, path: "expenses" },
  { label: "Time Tracking", icon: Clock, path: "time-tracking" },
  { label: "Clients", icon: Users, path: "clients" },
  { label: "Reports", icon: BarChart3, path: "reports" },
  { label: "Payments", icon: CreditCard, path: "payments" },
  { label: "Projects", icon: FolderKanban, path: "projects" },
];

const SidebarNav = ({ companyId, company, onNavClick, onLogout, onBackToAdmin }: {
  companyId: string | null;
  company: any;
  onNavClick?: () => void;
  onLogout: () => void;
  onBackToAdmin: () => void;
}) => (
  <>
    {/* Company header */}
    <div className="p-4 border-b border-primary-foreground/10 flex items-center justify-center">
      <img src={logo} alt="Logo" className="h-10" />
    </div>

    {/* Navigation */}
    <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={`/client/${companyId}/${item.path}`}
          onClick={onNavClick}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
              isActive
                ? "bg-primary-foreground/15 text-primary-foreground border-l-4 border-primary-foreground"
                : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground border-l-4 border-transparent"
            }`
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>

    {/* Footer */}
    <div className="p-3 border-t border-primary-foreground/10 space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-primary-foreground/60 hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={() => { onBackToAdmin(); onNavClick?.(); }}
      >
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Admin
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-primary-foreground/60 hover:text-red-300 hover:bg-primary-foreground/10"
        onClick={onLogout}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sign Out
      </Button>
    </div>
  </>
);

const FBLayout = () => {
  const { company, loading, companyId } = useCompany();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const handleBackToAdmin = () => {
    navigate("/admin");
  };

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-muted/30">
        <div className="h-14 bg-primary" />
        <div className="h-[3px] bg-[hsl(40,96%,53%)]" />
        <div className="flex-1 p-8">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-muted/30">
      {/* Desktop persistent sidebar */}
      {!isMobile && (
        <aside className="w-60 bg-primary text-primary-foreground flex flex-col shrink-0 h-screen">
          <SidebarNav
            companyId={companyId}
            company={company}
            onLogout={handleLogout}
            onBackToAdmin={handleBackToAdmin}
          />
        </aside>
      )}

      {/* Mobile Sheet sidebar */}
      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 bg-primary border-primary" hideCloseButton>
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <SidebarNav
              companyId={companyId}
              company={company}
              onNavClick={() => setSidebarOpen(false)}
              onLogout={handleLogout}
              onBackToAdmin={handleBackToAdmin}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 h-screen">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
          <div className="flex items-center justify-between h-14 px-4 md:px-6">
            {/* Left: hamburger + logo (mobile only) */}
            <div className="flex items-center gap-3">
              {isMobile && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary-foreground hover:bg-primary-foreground/10"
                    onClick={() => setSidebarOpen(true)}
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                  <img src={logo} alt="Logo" className="h-8 cursor-pointer" onClick={() => navigate(`/client/${companyId}/dashboard`)} />
                </>
              )}
              <span className="text-sm font-medium text-primary-foreground">
                {company?.name}
              </span>
            </div>

            {/* Right: search, notifications, dark mode */}
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center bg-primary-foreground/10 rounded-lg px-3 py-1.5">
                <Search className="h-4 w-4 text-primary-foreground/60 mr-2" />
                <Input
                  placeholder="Search..."
                  className="bg-transparent border-none text-primary-foreground placeholder:text-primary-foreground/50 h-7 w-40 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Bell className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </header>

        {/* Gold accent line */}
        <div className="h-[3px] bg-[hsl(40,96%,53%)] shrink-0" />

        {/* Main content */}
        <main className="flex-1 overflow-auto min-w-0">
          <div className="p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default FBLayout;
