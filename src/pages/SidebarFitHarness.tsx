/** Dev-only sidebar fit shots. Demo rows, not a live company. Spacing comes from v8.css. */
import { useEffect, type ElementType } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bell, Briefcase, CalendarDays, ChevronDown, FileText, Home, Inbox, LogOut, MoreHorizontal,
  Package, Plus, Users, Wallet, X,
} from "lucide-react";

type Role = "admin" | "sales" | "tech";
type Frame = "desktop" | "tablet" | "phone";

const PRIMARY: Record<Role, string[]> = {
  admin: ["Home", "Jobs", "Invoices", "Stock", "Schedule"],
  sales: ["Home", "Pipeline", "Quotes", "Schedule", "Clients"],
  tech: ["Today", "Schedule", "Earnings"],
};

const ICONS: Record<string, ElementType> = {
  Home, Jobs: Briefcase, Invoices: Wallet, Stock: Package, Schedule: CalendarDays,
  Pipeline: Inbox, Quotes: FileText, Clients: Users, Today: Home, Earnings: Wallet,
};

function measureSidebar() {
  const navs = [...document.querySelectorAll<HTMLElement>(".v8-nav")];
  const sub = document.querySelector<HTMLElement>(".v8-sub");
  const group = document.querySelector<HTMLElement>(".v8-group");
  const box = (el: HTMLElement | null) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const icon = el.querySelector("svg");
    const ir = icon?.getBoundingClientRect();
    return {
      h: Math.round(r.height * 10) / 10,
      font: s.fontSize,
      weight: s.fontWeight,
      pad: s.padding,
      gap: s.columnGap || s.gap,
      radius: s.borderRadius,
      icon: ir ? Math.round(ir.width * 10) / 10 : null,
    };
  };
  const pitch = navs.length > 1
    ? Math.round((navs[1].getBoundingClientRect().top - navs[0].getBoundingClientRect().bottom) * 10) / 10
    : null;
  const header = document.querySelector<HTMLElement>("[data-fit-header]");
  const first = navs[0];
  const headerToNav = header && first
    ? Math.round((first.getBoundingClientRect().top - header.getBoundingClientRect().bottom) * 10) / 10
    : null;
  const pre = document.createElement("pre");
  pre.id = "sidebar-measure";
  pre.textContent = JSON.stringify({
    nav: box(navs[0] ?? null),
    navGap: pitch,
    sub: box(sub),
    group: box(group),
    headerToNav,
  }, null, 2);
  document.body.appendChild(pre);
}

function Menu({ role, active = "Home" }: { role: Role; active?: string }) {
  const items = PRIMARY[role];
  return (
    <div className="v8-side flex h-full flex-col" data-testid="v8-sidebar" data-role={role}>
      <div className="px-3 pt-2.5" data-fit-header>
        <div className="v8-halo-mark" data-testid="v8-halo-mark">
          <div className="v8-mark">Field Lynk</div>
          <div className="v8-mark-sync">SYNC</div>
        </div>
        <div className="mt-1.5 truncate text-sm font-bold" data-testid="v8-company">Demo company (Pty) Ltd</div>
        <button type="button" className="v8-user mt-1.5 flex w-full items-center gap-2 rounded-xl p-1.5 text-left" data-testid="v8-namecard">
          <span className="v8-av flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">JB</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Johan Botha</div>
            <div className="truncate text-xs opacity-70">{role === "admin" ? "Owner · admin" : role === "sales" ? "Sales" : "Technician"}</div>
          </div>
          {role === "admin" && <ChevronDown className="ml-auto h-4 w-4 shrink-0" />}
        </button>
      </div>
      <nav className="mt-[13px] flex-1 overflow-y-auto px-2" aria-label="Main">
        {items.map((label) => {
          const Icon = ICONS[label] ?? Home;
          const on = label === (role === "tech" ? "Today" : active);
          return (
            <button key={label} type="button" className={on ? "v8-nav is-active" : "v8-nav"} aria-current={on ? "page" : undefined}>
              <Icon className="h-4 w-4" />{label}
              {label === "Invoices" && (
                <span className="ml-auto flex flex-col items-end leading-tight">
                  <span className="rounded-full bg-[#E5484D] px-2 text-xs font-bold text-white">2</span>
                  <span className="text-[11px] font-medium text-[#E5484D]">R4.5k overdue</span>
                </span>
              )}
            </button>
          );
        })}
        {role === "admin" ? (
          <div className="mt-1 space-y-0 pb-1" data-testid="v8-groups">
            <div>
              <button type="button" className="v8-group is-open" aria-expanded="true">
                <ChevronDown className="h-4 w-4" />
                <span className="flex-1 text-left">Jobs & requests</span>
                <span className="text-[11px] font-medium opacity-60">3</span>
              </button>
              <button type="button" className="v8-sub pl-6"><Inbox className="h-4 w-4" />Pipeline</button>
              <button type="button" className="v8-sub pl-6"><Users className="h-4 w-4" />Clients</button>
              <button type="button" className="v8-sub pl-6"><FileText className="h-4 w-4" />Quotes</button>
            </div>
            <button type="button" className="v8-group">
              <ChevronDown className="h-4 w-4 -rotate-90" />
              <span className="flex-1 text-left">Money</span>
              <span className="text-[11px] font-medium opacity-60">6</span>
            </button>
            <button type="button" className="v8-group">
              <ChevronDown className="h-4 w-4 -rotate-90" />
              <span className="flex-1 text-left">Suppliers & stock</span>
              <span className="text-[11px] font-medium opacity-60">4</span>
            </button>
          </div>
        ) : (
          <button type="button" className="v8-nav" data-testid="v8-more">
            <MoreHorizontal className="h-4 w-4" />More
            <ChevronDown className="ml-auto h-4 w-4" />
          </button>
        )}
      </nav>
      <div className="space-y-1 px-3 pb-2 pt-1">
        {role === "tech" ? (
          <button type="button" className="v8-leads tone-blue"><Briefcase className="h-4 w-4" />Job offers</button>
        ) : (
          <div className="flex gap-1.5">
            <button type="button" className="v8-leads tone-blue flex-1"><Bell className="h-4 w-4 shrink-0" />3 new leads</button>
            <button type="button" className="v8-leads tone-blue w-10 justify-center px-0" aria-label="Create lead"><Plus className="h-4 w-4" /></button>
          </div>
        )}
        <button type="button" className="v8-sub"><LogOut className="h-4 w-4" />Sign out</button>
      </div>
    </div>
  );
}

export default function SidebarFitHarness() {
  const [sp] = useSearchParams();
  const role = (["admin", "sales", "tech"].includes(sp.get("role") || "") ? sp.get("role") : "admin") as Role;
  const frame = (["desktop", "tablet", "phone"].includes(sp.get("frame") || "") ? sp.get("frame") : "desktop") as Frame;
  const phone = frame === "phone";
  useEffect(() => {
    if (sp.get("measure") !== "1") return;
    const id = requestAnimationFrame(() => measureSidebar());
    return () => cancelAnimationFrame(id);
  }, [sp, role, frame]);

  const menu = <Menu role={role} />;
  return (
    <div data-testid={`sidebar-fit-${frame}-${role}`} style={{ height: "100vh", background: "#e9e7e4", display: "flex", overflow: "hidden" }}>
      {phone ? (
        <div className="relative h-full w-full">
          <div className="absolute inset-0 bg-black/35" />
          <div className="v8-drawer absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-2xl" data-testid="sidebar-fit-side">
            <button type="button" className="absolute right-2 top-2 rounded-full p-2" aria-label="Close menu"><X className="h-5 w-5" /></button>
            {menu}
          </div>
        </div>
      ) : (
        <>
          <aside className="v8-richer-halo h-full w-[232px] shrink-0" data-testid="sidebar-fit-side">{menu}</aside>
          <div style={{ flex: 1, padding: 16, color: "#5D7086", fontSize: 13 }}>
            Demo harness — {role} sidebar, {frame}. Not live Massair CT.
          </div>
        </>
      )}
    </div>
  );
}
