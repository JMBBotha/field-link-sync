import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import { useTheme } from "@/hooks/useTheme";
import {
  LayoutDashboard, FileText, FileBarChart, Receipt,
  Clock, Users, BarChart3, CreditCard, FolderKanban,
  LogOut, ChevronLeft, Menu, X, Search, Bell, Moon, Sun
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import BeCoolLogo from "@/components/shared/BeCoolLogo";

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

const FBLayout = () => {
  const { company, loading, companyId } = useCompany();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-muted/30">
        <div className="hidden md:block w-60 bg-card border-r p-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-muted/30">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
        <div className="flex items-center justify-between h-14 px-4 md:px-6">
          {/* Left: hamburger + logo/company */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-primary-foreground hover:bg-primary/80"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate(`/client/${companyId}/dashboard`)}
            >
              <BeCoolLogo />
              <span className="hidden sm:inline text-sm font-medium text-primary-foreground/80 ml-2">
                {company?.name}
              </span>
            </div>
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
              className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary/80"
            >
              <Bell className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary/80"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        {/* Blue accent line */}
        <div className="h-1 bg-accent" />
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-50 w-60 bg-card border-r border-border flex flex-col
            transform transition-transform duration-200 ease-in-out
            md:relative md:translate-x-0 md:shrink-0 md:top-0
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          {/* Mobile close button */}
          <div className="md:hidden flex items-center justify-between p-3 border-b border-border">
            <BeCoolLogo />
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Company header (desktop) */}
          <div className="hidden md:block p-4 border-b border-border">
            <div className="flex items-center gap-3">
              {company?.logo_url ? (
                <img src={company.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                  {company?.name?.charAt(0) || "C"}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{company?.name || "Company"}</p>
                <p className="text-xs text-muted-foreground">Business</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={`/client/${companyId}/${item.path}`}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                    isActive
                      ? "border-l-4 border-primary text-primary bg-primary/5"
                      : "text-foreground hover:bg-primary/5 border-l-4 border-transparent"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t border-border space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={() => { navigate("/admin"); setSidebarOpen(false); }}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </aside>

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
