import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import {
  LayoutDashboard, FileText, FileBarChart, Receipt,
  Clock, Users, BarChart3, CreditCard, FolderKanban, LogOut, ChevronLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="flex h-screen bg-[hsl(0,0%,96%)]">
        <div className="w-60 bg-white border-r p-4 space-y-4">
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
    <div className="flex h-screen bg-[hsl(0,0%,96%)]">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-[hsl(0,0%,90%)] flex flex-col">
        {/* Company header */}
        <div className="p-4 border-b border-[hsl(0,0%,90%)]">
          <div className="flex items-center gap-3">
            {company?.logo_url ? (
              <img src={company.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-[hsl(211,100%,43%)]/10 flex items-center justify-center text-[hsl(211,100%,43%)] font-bold text-sm">
                {company?.name?.charAt(0) || "C"}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[hsl(0,0%,29%)] truncate">{company?.name || "Company"}</p>
              <p className="text-xs text-[hsl(0,0%,53%)]">Business</p>
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
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[hsl(211,100%,43%)]/10 text-[hsl(211,100%,43%)]"
                    : "text-[hsl(0,0%,29%)] hover:bg-[hsl(0,0%,96%)]"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[hsl(0,0%,90%)] space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[hsl(0,0%,53%)] hover:text-[hsl(0,0%,29%)]"
            onClick={() => navigate("/admin")}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Admin
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[hsl(0,0%,53%)] hover:text-red-600"
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
        <header className="sticky top-0 z-10 h-14 bg-white border-b border-[hsl(0,0%,90%)] flex items-center px-6 justify-between">
          <h1 className="text-lg font-semibold text-[hsl(0,0%,29%)]">{company?.name}</h1>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default FBLayout;
