import { createContext, useContext } from "react";
import { NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { CalendarDays, Home, UserRound, Users, Briefcase } from "lucide-react";
import { useV8Role } from "@/components/v8/V8Sidebar";
import {
  V8_SIMPLE_BOOK_JOB,
  v8SimpleRoleFromQuery,
  v8SimpleShowsBookJob,
  v8SimpleTabPath,
  v8SimpleTabs,
  type V8SimpleRole,
  type V8SimpleTab,
} from "@/lib/v8simple/nav";
import "@/components/v8/roleHome/roleHome.css";
import "./v8simple.css";

const ICONS = {
  home: Home,
  jobs: Briefcase,
  schedule: CalendarDays,
  clients: Users,
  me: UserRound,
} as const;

const RoleCtx = createContext<V8SimpleRole>("admin");
export function usePreviewRole(): V8SimpleRole {
  return useContext(RoleCtx);
}

function tabActive(tab: V8SimpleTab, pathname: string, root: string): boolean {
  const path = v8SimpleTabPath(root, tab);
  if (!tab.segment) return pathname === root || pathname === `${root}/`;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function Frame({ root, role }: { root: string; role: V8SimpleRole }) {
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const tabs = v8SimpleTabs(role);
  const keep = new URLSearchParams();
  if (sp.get("role")) keep.set("role", sp.get("role")!);
  if (sp.get("v8simple")) keep.set("v8simple", sp.get("v8simple")!);
  const href = (tab: V8SimpleTab) => {
    const path = v8SimpleTabPath(root, tab);
    const q = keep.toString();
    return q ? `${path}?${q}` : path;
  };
  const book = v8SimpleShowsBookJob(role);
  const onJob = /\/jobs\/[^/]+/.test(pathname);
  const onAdminHome = role === "admin" && (pathname === root || pathname === `${root}/`);
  return (
    <RoleCtx.Provider value={role}>
    <div className="v8s" data-testid="v8-simple-shell" data-role={role}>
      <aside className="v8s-side v8-richer-halo" data-testid="v8-simple-side" aria-label="Side menu">
        <div className="v8-halo-mark">
          <div className="v8-mark">Field Lynk</div>
          <div className="v8-mark-sync">SYNC</div>
        </div>
        <nav aria-label="Main">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={href(tab)}
              className={() => `v8-nav${tabActive(tab, pathname, root) ? " is-active" : ""}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="v8s-main">
        <header className="v8s-bar" data-testid="v8-simple-bar">
          <span>Field Lynk</span>
          <small>Demo Company · preview</small>
        </header>
        <div className="v8s-stage">
          <div className="v8s-map" aria-hidden />
          <div className="v8s-scroll">
            <p className="v8s-note">Preview · example data</p>
            <Outlet />
          </div>
        </div>
      </div>
      <nav className="v8s-tabs" data-testid="v8-simple-tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const Icon = ICONS[tab.id];
          return (
            <NavLink
              key={tab.id}
              to={href(tab)}
              className={() => `v8s-tab${tabActive(tab, pathname, root) ? " is-active" : ""}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </nav>
      {book && !onJob && !onAdminHome && (
        <NavLink to={V8_SIMPLE_BOOK_JOB} className="v8s-book" data-testid="v8-simple-book" data-orange="main">
          Book a job
        </NavLink>
      )}
    </div>
    </RoleCtx.Provider>
  );
}

/** Query role wins (screenshots and the harness). Otherwise the signed-in role. */
export default function V8SimpleShell({ root = "/v8" }: { root?: string }) {
  const [sp] = useSearchParams();
  const forced = v8SimpleRoleFromQuery(sp.get("role"));
  if (forced) return <Frame root={root} role={forced} />;
  return <Detected root={root} />;
}

function Detected({ root }: { root: string }) {
  const detected = useV8Role();
  const role: V8SimpleRole = detected === "tech" ? "tech" : detected === "sales" ? "sales" : "admin";
  return <Frame root={root} role={role} />;
}

export { tabActive };
