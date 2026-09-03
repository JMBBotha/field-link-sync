import { NavLink, useLocation } from "react-router-dom";
import { Home, Briefcase, Map, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminBottomNavProps {
  onOpenMenu: () => void;
}

const tabs = [
  { to: "/admin", label: "Home", icon: Home, exact: true },
  { to: "/admin/jobs/dispatch", label: "Board", icon: Briefcase },
  { to: "/admin/map", label: "Map", icon: Map },
];

const AdminBottomNav = ({ onOpenMenu }: AdminBottomNavProps) => {
  const { pathname } = useLocation();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-slate-700/60 bg-gradient-to-b from-slate-800 to-slate-900 text-slate-100 backdrop-blur-md [--muted-foreground:215_20%_75%] [--foreground:210_40%_98%]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4 h-full">
        {tabs.map((tab) => {
          const active = isActive(tab.to, tab.exact);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-h-[48px] transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && <span className="absolute top-1 h-1 w-8 rounded-full bg-primary" />}
              <tab.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default AdminBottomNav;
