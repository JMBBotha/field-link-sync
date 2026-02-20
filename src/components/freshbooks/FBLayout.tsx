import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import {
  LayoutDashboard, FileText, FileBarChart, Receipt,
  Clock, Users, BarChart3, CreditCard, FolderKanban, LogOut, ChevronLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import logoUrl from "@/assets/logo.png";

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-muted/30">
        <div className="w-60 bg-card border-r p-4 space-y-4">
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
    <div className="flex h-screen bg-muted/30">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-card border-r border-border flex flex-col">
        {/* Company header */}
        <div className="p-4 border-b border-border">
          <img src={logoUrl} alt="0800BeCool" className="w-36 h-auto mb-4 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="flex items-center gap-3">
            {company?.logo_url ? (
              <img src={company.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 font-bold text-sm">
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
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "border-l-4 border-amber-500 text-amber-600 bg-amber-50"
                    : "text-foreground hover:bg-amber-50 border-l-4 border-transparent"
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
            onClick={() => navigate("/admin")}
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 h-14 bg-card border-b border-border flex items-center px-6 justify-between">
          <h1 className="text-lg font-semibold text-foreground">{company?.name}</h1>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default FBLayout;
