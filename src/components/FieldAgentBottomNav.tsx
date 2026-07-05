import { NavLink, useLocation } from "react-router-dom";
import { Home, ClipboardList, CalendarDays, Map, CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOfflineContext } from "@/contexts/OfflineContext";

/**
 * Mobile bottom navigation for field technicians.
 * Route-driven (NavLink) so it stays in sync across /field/* pages.
 * Four tabs: Home / My Jobs / Schedule / Map.
 */
const tabs = [
  { to: "/field", label: "Home", icon: Home, match: (p: string) => p === "/field" && !p.includes("view=map") },
  { to: "/field/my-jobs", label: "My Jobs", icon: ClipboardList, match: (p: string) => p.startsWith("/field/my-jobs") },
  { to: "/field/schedule", label: "Schedule", icon: CalendarDays, match: (p: string) => p.startsWith("/field/schedule") },
  { to: "/field?view=map", label: "Map", icon: Map, match: (p: string, s: string) => p === "/field" && s.includes("view=map") },
] as const;

const FieldAgentBottomNav = () => {
  const { pathname, search } = useLocation();
  const { isOnline, syncStatus } = useOfflineContext();
  const pending = syncStatus?.pendingCount ?? 0;

  return (
    <>
      {/* Offline / pending indicator strip — sits just above the nav */}
      {(!isOnline || pending > 0) && (
        <div
          className={cn(
            "fixed left-0 right-0 z-50 md:hidden flex items-center justify-center gap-2 text-[11px] font-medium px-3 py-1.5",
            !isOnline
              ? "bg-amber-500/95 text-amber-950"
              : "bg-blue-500/95 text-white"
          )}
          style={{ bottom: "calc(68px + env(safe-area-inset-bottom))" }}
        >
          {!isOnline ? (
            <>
              <CloudOff className="h-3.5 w-3.5" />
              Offline
              {pending > 0 && <span>· {pending} pending</span>}
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Syncing {pending} pending {pending === 1 ? "change" : "changes"}
            </>
          )}
        </div>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-blue-400/20 bg-gradient-to-r from-[#0a1628]/95 via-[#0f2240]/95 to-[#0a1628]/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4 h-[68px]">
          {tabs.map((tab) => {
            const active = tab.match(pathname, search);
            return (
              <NavLink
                key={tab.label}
                to={tab.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 relative transition-colors active:scale-[0.96]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {active && (
                  <span className="absolute top-1 h-1 w-8 rounded-full bg-primary" />
                )}
                <tab.icon className="h-6 w-6" strokeWidth={active ? 2.4 : 2} />
                <span className="text-[11px] font-medium leading-none">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default FieldAgentBottomNav;
