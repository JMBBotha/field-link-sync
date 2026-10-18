import { NavLink, useLocation } from "react-router-dom";
import { Home, Briefcase, Map, Menu, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoleColours } from "@/hooks/useSignedInIdentity";
import { useSalesRep } from "@/hooks/useSalesRep";
import { jobsTabFor } from "@/lib/visits";
import { useRole } from "@/hooks/useRole";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { useLeadSla } from "@/hooks/useLeadSla";
import { inboxTone } from "@/lib/leadClock";

interface AdminBottomNavProps {
  onOpenMenu: () => void;
}

const tabs = [
  { to: "/admin", label: "Home", icon: Home, exact: true },
  { to: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { to: "/admin/map", label: "Map", icon: Map },
];

const AdminBottomNav = ({ onOpenMenu }: AdminBottomNavProps) => {
  const { pathname } = useLocation();
  const { isSalesRep } = useSalesRep();
  const { colours } = useRoleColours();
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const { leads } = useLeadInbox();
  const { sla } = useLeadSla();
  // New Leads tone dot on Menu (not for techs). Re-evaluated on each 60s inbox refetch / realtime change.
  const tone = isFieldAgent && !isAdmin && !isDispatcher ? null : inboxTone(leads as any[], Date.now(), sla);
  const dot = tone ? { red: "bg-[#DC2626]", amber: "bg-[#EAB308]", green: "bg-[#16a34a]", grey: "bg-[#6b7280]" }[tone.tone] : null;
  // Reps: Map is hidden (step 2); its slot becomes the read-only PDF price lists.
  const visibleTabs = isSalesRep
    ? [
        ...tabs
          .filter((t) => t.to !== "/admin/map")
          // P1: reps' "Jobs" slot becomes "Visits" (/admin/visits).
          .map((t) => (t.to === "/admin/jobs" ? { ...t, ...jobsTabFor(true) } : t)),
        { to: "/admin/price-lists", label: "Prices", icon: BookOpen },
      ]
    : tabs;
  const gridCols = visibleTabs.length + 1 === 3 ? "grid-cols-3" : "grid-cols-4";

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-slate-700/60 bg-gradient-to-b from-slate-800 to-slate-900 text-slate-100 backdrop-blur-md [--muted-foreground:215_20%_75%] [--foreground:210_40%_98%]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className={cn("grid h-full", gridCols)}>
        {visibleTabs.map((tab) => {
          const active = isActive(tab.to, tab.exact);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-h-[48px] transition-colors",
                active ? (colours?.navText ?? "text-primary") : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && <span className={cn("absolute top-1 h-1 w-8 rounded-full", colours?.navBar ?? "bg-primary")} />}
              <tab.icon className="h-5 w-5" />
              <span className="text-xs font-medium">{tab.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className="relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label={tone ? `Menu · New Leads ${tone.tone === "red" ? "overdue" : tone.tone === "amber" ? "due soon" : "waiting"}` : "Menu"}
        >
          <span className="relative">
            <Menu className="h-5 w-5" />
            {dot && <span data-testid="menu-lead-dot" className={cn("absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900", dot)} />}
          </span>
          <span className="text-xs font-medium">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default AdminBottomNav;
