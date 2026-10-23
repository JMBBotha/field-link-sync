import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole, type AppRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { LayoutDashboard, CalendarDays, FileText, Receipt, Package, BarChart3, ShoppingBag, LineChart, Bell, History, Upload, Settings, Plus, Users, LogOut, ChevronLeft, ChevronRight, ChevronDown, X, Building2, Briefcase, ClipboardList, Sparkles, HelpCircle, Mail, Navigation, Wallet, BookOpen, UserPlus, Tag, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { sidebarRoleLabel } from "@/lib/sidebarRoleLabel";
import { useLeadInbox, INBOX_ROUTE } from "@/hooks/useLeadInbox";
import { usePendingApplicants } from "@/hooks/usePendingApplicants";
import LayoutToggleButton from "@/components/classic/LayoutToggleButton";
import { usePlatformOwner } from "@/components/RequirePlatformOwner";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { useLeadSla, useNow } from "@/hooks/useLeadSla";
import { inboxTone } from "@/lib/leadClock";
import { span as hm } from "@/lib/leadFlow";
import { useSalesHeartbeat } from "@/hooks/useSalesHeartbeat";

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  badgeTone?: "red" | "blue";
  badgeTitle?: string;
  roles?: AppRole[]; // undefined = all authenticated
  children?: NavItem[];
}

interface NavGroup {
  title: string;
  roles?: AppRole[];
  items: NavItem[];
}

interface AdminSidebarProps {
  onCreateLead: () => void;
  onSignOut: () => void;
  pendingRequestsCount?: number;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const AdminSidebar = ({
  onCreateLead,
  onSignOut,
  mobileOpen,
  onMobileClose,
}: AdminSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Bottom "Settings & account" block: closed by default to keep the menu short.
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isDispatcher, isFieldAgent, roles } = useRole();
  const { settings } = useCompanySettings();
  const { isSalesRep } = useSalesRep();
  const { isMain: isMainCo } = useIsMainCompany();
  const { count: inboxCount, leads: inboxLeads } = useLeadInbox();
  const { isPlatformOwner } = usePlatformOwner();
  const identity = useSignedInIdentity();
  const { sla } = useLeadSla();
  const now = useNow();
  // Lead rule (Johan 13 Oct): techs never see the New Leads inbox or Create lead (also enforced by RLS).
  const techOnly = isFieldAgent && !isAdmin && !isDispatcher;
  const tone = techOnly ? null : inboxTone(inboxLeads as any[], Math.floor(now / 30_000) * 30_000, sla);
  // New Leads button (Johan 20 Oct): red + count when hot leads wait for "I'm on it" (heartbeat hb.hot), green otherwise.
  const { hb, canSee: hbCanSee } = useSalesHeartbeat(!techOnly);
  const hotCount = !techOnly && hbCanSee ? (hb?.hot.length ?? 0) : 0;
  const toneClass = hotCount > 0 ? "bg-[#DC2626] hover:bg-[#DC2626]/90 text-white ring-2 ring-red-300/50" : "";
  const hotLabel = hotCount > 99 ? "99+" : String(hotCount);
  const initials = (identity?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const { count: pendingApplicants } = usePendingApplicants();


  const companyName = settings?.company_name?.trim() || "My Company";
  const roleLabel = sidebarRoleLabel(roles, isSalesRep);

  const { data: lowStockItems = [] } = useQuery({
    queryKey: ["low-stock-items-sidebar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("product_id, quantity, low_stock_threshold, stock_mode, supplier_products:product_id(description, product_code)");
      if (error) return [];
      return (data || []).filter(
        (r: any) => r.stock_mode === "stock_sensitive" && r.quantity <= r.low_stock_threshold
      );
    },
    refetchInterval: 60000,
  });
  const lowStockCount = lowStockItems.length;

  // v7 sidebar badges (existing columns only): quotes awaiting the client (sent, not yet answered) and overdue invoices.
  const { data: docCounts } = useQuery({
    queryKey: ["v7-sidebar-doc-counts"],
    enabled: !techOnly,
    refetchInterval: 120000,
    queryFn: async () => {
      const [q, i] = await Promise.all([
        supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "sent").is("archived_at", null),
        isSalesRep ? Promise.resolve({ count: 0 } as any) : supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "overdue"),
      ]);
      return { quotesOpen: q.count ?? 0, invoicesOverdue: i.count ?? 0 };
    },
  });

  // FreshBooks-style ordering. Every existing route is preserved —
  // items are only regrouped/relabelled for the accounting-app layout.
  const navGroups: NavGroup[] = [
    {
      title: "Main",
      items: [
        { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
        { path: "/admin/customers", label: "Clients", icon: Users },
        {
          // When the badge shows quotes waiting on the client, land on that filter directly.
          path: docCounts?.quotesOpen ? "/admin/quotes?status=sent" : "/admin/quotes",
          label: "Quotes",
          icon: FileText,
          roles: ["admin", "dispatcher", "viewer"],
          badge: docCounts?.quotesOpen || undefined,
          badgeTone: "blue",
          badgeTitle: "sent, waiting on the client",
        },
        {
          path: "/admin/invoices",
          label: "Invoices",
          icon: Receipt,
          roles: ["admin", "dispatcher", "viewer"],
          badge: docCounts?.invoicesOverdue || undefined,
          badgeTitle: "overdue",
        },
        // Accounting (steps 4-5): office only, hidden for salespeople.
        ...(isSalesRep ? [] : [{ path: "/admin/expenses", label: "Expenses", icon: Wallet, roles: ["admin", "dispatcher"] } as NavItem, { path: "/admin/bank", label: "Bank (FNB)", icon: Upload, roles: ["admin", "dispatcher"] } as NavItem, { path: "/admin/payment-followups", label: "Payment follow-ups", icon: Receipt, roles: ["admin", "dispatcher"] } as NavItem, { path: "/admin/supplier-bills", label: "Supplier bills", icon: Wallet, roles: ["admin"] } as NavItem, { path: "/admin/cashflow", label: "Cash flow & profit", icon: Receipt, roles: ["admin"] } as NavItem, ...(isMainCo ? [{ path: "/admin/company-plans", label: "Company plans", icon: Wallet, roles: ["admin"] } as NavItem] : [])]),
        {
          path: "/admin/jobs",
          label: "Jobs & Dispatch",
          icon: Briefcase,
          children: [
            // Dispatch calendar + Schedule are views inside Dispatch now (old URLs redirect); techs use /field.
            { path: "/admin/jobs?tab=pipeline", label: "Sales pipeline", icon: BarChart3, roles: ["admin", "dispatcher", "viewer"] },
            // Dispatch lockdown: hidden for salespeople (dispatcher + sales lane).
            ...(isSalesRep ? [] : [{ path: "/admin/jobs?tab=dispatch", label: "Dispatch", icon: ClipboardList, roles: ["admin", "dispatcher", "viewer"] } as NavItem]),
          ],
        },
        ...(isSalesRep ? [{ path: "/admin/visits", label: "My visits", icon: MapPin } as NavItem] : []),
        ...(isSalesRep ? [{ path: "/admin/my-appointments", label: "My appointments", icon: CalendarDays } as NavItem] : []),
        { path: "/admin/my-commission", label: "My commission", icon: Wallet, roles: ["admin", "dispatcher"] },
        { path: "/field/earnings", label: "Tech earnings", icon: Wallet, roles: ["admin"] },
        ...(isSalesRep ? [] : [{ path: "/admin/map", label: "Live Tracking", icon: Navigation } as NavItem]),
        {
          path: "/admin/catalog",
          label: "Items",
          icon: ShoppingBag,
          roles: ["admin", "dispatcher"],
          badge: lowStockCount > 0 ? lowStockCount : undefined,
          children: [
            { path: "/admin/catalog", label: "Catalog", icon: ShoppingBag },
            ...(isSalesRep ? [] : [
              { path: "/admin/inventory", label: "Stock", icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined } as NavItem,
              { path: "/admin/suppliers", label: "Suppliers", icon: Building2 } as NavItem,
              { path: "/admin/specials", label: "Specials", icon: Tag } as NavItem,
            ]),
          ],
        },
        { path: "/admin/price-lists", label: "Price lists", icon: BookOpen, roles: ["admin", "dispatcher"] },
        { path: "/admin/team", label: "Team", icon: Users, roles: ["admin"], badge: pendingApplicants > 0 ? pendingApplicants : undefined },
        ...(isSalesRep ? [] : [{
          path: "/admin/reports",
          label: "Reports",
          icon: BarChart3,
          roles: ["admin", "dispatcher", "viewer"],
          children: [
            { path: "/admin/reports/aging", label: "Accounts Aging", icon: History },
            { path: "/admin/reports/sales-by-client", label: "Sales by Client", icon: Users },
            { path: "/admin/reports/sales-by-product", label: "Sales by Product", icon: ShoppingBag },
            { path: "/admin/reports/vat", label: "VAT Report", icon: Receipt },
            { path: "/admin/analytics", label: "Analytics", icon: LineChart },
          ],
        } as NavItem]),
      ],
    },
  ];

  // Footer-only advanced/legacy links — never in daily primary nav.
  const advancedItems: NavItem[] = [
    { path: "/admin/audit", label: "Audit Log", icon: History },
    { path: "/admin/import", label: "Import", icon: Upload },
    { path: "/admin/companies", label: "Companies", icon: Building2 },
    // Sales reps don't use /field (they'd be redirected to My visits anyway).
    ...(isSalesRep ? [] : [{ path: "/field", label: "Field Agent View", icon: Users } as NavItem]),
  ];

  const hasRole = (allowed?: AppRole[]) => {
    if (!allowed || allowed.length === 0) return true;
    return allowed.some((r) => roles.includes(r));
  };

  // Field agents get a minimal focused view: Dashboard, Jobs (My Jobs, Schedule, Map)
  const fieldAgentOnlyPaths = new Set([
    "/admin",
    "/admin/jobs",
    "/admin/jobs/dispatch",
    "/admin/my-jobs",
    "/admin/schedule",
    "/admin/map",
  ]);

  const filterItem = (item: NavItem): NavItem | null => {
    if (!hasRole(item.roles)) return null;
    if (isFieldAgent && !isAdmin && !isDispatcher) {
      const inSet =
        fieldAgentOnlyPaths.has(item.path) ||
        item.children?.some((c) => fieldAgentOnlyPaths.has(c.path));
      if (!inSet) return null;
      if (item.children) {
        const kids = item.children.filter((c) => fieldAgentOnlyPaths.has(c.path) && c.path !== "/admin/jobs/dispatch");
        return { ...item, children: kids.length ? kids : undefined };
      }
    }
    if (item.children) {
      const kids = item.children.filter((c) => hasRole(c.roles));
      return { ...item, children: kids.length ? kids : undefined };
    }
    return item;
  };

  const visibleGroups = navGroups
    .filter((g) => hasRole(g.roles))
    .map((g) => ({ ...g, items: g.items.map(filterItem).filter(Boolean) as NavItem[] }))
    .filter((g) => g.items.length > 0);

  // v7 section headings (look only; same items, routes and role filters as before).
  const SECTION_OF: Record<string, string> = {
    "/admin": "Main", "/admin/customers": "Main", "/admin/quotes": "Main", "/admin/invoices": "Main", "/admin/expenses": "Main", "/admin/bank": "Main", "/admin/supplier-bills": "Main", "/admin/payment-followups": "Main", "/admin/cashflow": "Main", "/admin/company-plans": "Main",
    "/admin/jobs": "Operations", "/admin/visits": "Operations", "/admin/my-appointments": "Operations", "/admin/my-commission": "Operations", "/field/earnings": "Operations", "/admin/map": "Operations",
    "/admin/catalog": "Stock & pricing", "/admin/price-lists": "Stock & pricing",
    "/admin/team": "Insights & team", "/admin/reports": "Insights & team",
  };
  const sections = (() => {
    const out: { title: string; items: NavItem[] }[] = [];
    for (const it of visibleGroups.flatMap((g) => g.items)) {
      const t = SECTION_OF[it.path] || "Main";
      const last = out[out.length - 1];
      if (last && last.title === t) last.items.push(it); else out.push({ title: t, items: [it] });
    }
    return out;
  })();

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    const [base, query] = path.split("#")[0].split("?");
    if (query) {
      const have = new URLSearchParams(location.search);
      return location.pathname === base && [...new URLSearchParams(query)].every(([k, v]) => have.get(k) === v);
    }
    return location.pathname === base || location.pathname.startsWith(base + "/");
  };

  const isGroupActive = (item: NavItem) =>
    isActive(item.path) || (item.children?.some((c) => isActive(c.path)) ?? false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (item: NavItem) => expanded[item.path] ?? isGroupActive(item);

  const handleNav = (path: string) => {
    navigate(path);
    onMobileClose?.();
  };

  const [lowStockOpen, setLowStockOpen] = useState(false);

  const lowStockPopover = (trigger: React.ReactNode) => (
    <Popover open={lowStockOpen} onOpenChange={setLowStockOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-0">
        <div className="px-3 py-2 border-b font-semibold text-sm">{lowStockItems.length} low stock</div>
        <div className="max-h-56 overflow-y-auto">
          {lowStockItems.slice(0, 5).map((r: any) => (
            <div key={r.product_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.supplier_products?.description || "Unknown product"}</div>
                {r.supplier_products?.product_code && (
                  <div className="text-xs text-muted-foreground truncate">{r.supplier_products.product_code}</div>
                )}
              </div>
              <span className="shrink-0 text-xs font-bold text-destructive">
                {r.quantity} / {r.low_stock_threshold}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setLowStockOpen(false);
              handleNav("/admin/inventory?lowStock=1");
            }}
          >
            Open Stock
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const renderLeaf = (item: NavItem, depth = 0) => {
    const active = isActive(item.path);
    const btn = (
      <button
        onClick={() => handleNav(item.path)}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-md text-xs font-medium leading-tight transition-colors relative",
          collapsed ? "justify-center px-0 py-2" : "px-3 py-[5px]",
          depth > 0 && !collapsed && "pl-9 py-1 text-xs",
          active
            ? "bg-white/20 dark:bg-nav-active text-white font-semibold before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-[#F97316]"
            : "text-white/90 dark:text-nav-foreground/85 hover:text-white hover:bg-white/[0.12]",
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-80")} strokeWidth={1.75} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && item.badge && item.badge > 0 ? (
          <Badge variant="destructive" title={item.badgeTitle ? `${item.badge} ${item.badgeTitle}` : undefined} className={cn("ml-auto h-5 min-w-5 flex items-center justify-center p-0 px-1 text-xs", item.badgeTone === "blue" && "bg-white/25 text-white hover:bg-white/25")}>
            {item.badge > 99 ? "99+" : item.badge}
          </Badge>
        ) : null}
        {collapsed && item.badge && item.badge > 0 ? (
          <span className={cn("absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full text-xs text-white font-bold px-1", item.badgeTone === "blue" ? "bg-[#0b5e8a]" : "bg-destructive")}>
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </button>
    );
    if (collapsed) {
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return <div key={item.path}>{btn}</div>;
  };

  const renderItem = (item: NavItem) => {
    if (!item.children || item.children.length === 0) return renderLeaf(item);
    const open = isExpanded(item);
    const active = isGroupActive(item);
    const badged = !!(item.badge && item.badge > 0);
    if (collapsed) {
      // Collapsed: badged group opens the low-stock popover instead of navigating
      if (badged && item.path === "/admin/catalog") {
        const btn = (
          <button
            className="w-full flex items-center justify-center gap-3 rounded-md px-0 py-2 text-xs font-medium transition-colors relative text-nav-foreground/85 hover:text-white hover:bg-white/[0.07]"
          >
            <item.icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-destructive text-xs text-white font-bold px-1">
              {item.badge! > 99 ? "99+" : item.badge}
            </span>
          </button>
        );
        return (
          <Tooltip key={item.path} delayDuration={0}>
            {lowStockPopover(<TooltipTrigger asChild>{btn}</TooltipTrigger>)}
            <TooltipContent side="right" className="font-medium">
              {item.label} · {item.badge} low stock
            </TooltipContent>
          </Tooltip>
        );
      }
      return renderLeaf(item);
    }
    const groupBtn = (
      <button
        onClick={() => {
          // When badged, the PopoverTrigger handles opening; chevron still expands.
          if (item.path === "/admin/jobs") {
            // Jobs label navigates AND expands; chevron still only toggles.
            const fieldOnly = isFieldAgent && !isAdmin && !isDispatcher;
            setExpanded((s) => ({ ...s, [item.path]: true }));
            handleNav(fieldOnly ? "/admin/my-jobs" : item.path);
            return;
          }
          if (!badged) {
            setExpanded((s) => ({ ...s, [item.path]: !open }));
          }
        }}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-[5px] rounded-md text-xs font-medium leading-tight transition-colors relative",
          active
            ? "bg-white/20 dark:bg-nav-active text-white font-semibold before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-[#F97316]"
            : "text-white/90 dark:text-nav-foreground/85 hover:text-white hover:bg-white/[0.12]",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{item.label}</span>
        {badged ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-xs">
            {item.badge! > 99 ? "99+" : item.badge}
          </Badge>
        ) : null}
        <span
          role="button"
          aria-label={`Expand ${item.label}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((s) => ({ ...s, [item.path]: !open }));
          }}
          className={cn("p-1 -m-1 rounded hover:bg-white/10", !badged && "ml-auto")}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform opacity-70", open && "rotate-180")}
          />
        </span>
      </button>
    );
    return (
      <div key={item.path}>
        {badged && item.path === "/admin/catalog" ? lowStockPopover(groupBtn) : groupBtn}
        {open && <div className="mt-0.5 space-y-px">{item.children.map((c) => renderLeaf(c, 1))}</div>}
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#1AA7EC] to-[#1590D6] dark:from-[#0b1a2e] dark:to-[#08111f]">
      {/* Company switcher */}
      <div
        className={cn(
          "relative border-b border-white/15 px-2 py-1.5",
          collapsed && "px-2 py-2",
          mobileOpen && "pr-10 lg:pr-2"
        )}
      >
        <button
          onClick={() => handleNav(isSalesRep ? "/admin" : "/admin/settings")}
          className={cn(
            "flex w-full flex-col items-center gap-1 rounded-md p-0.5 transition-colors hover:bg-white/[0.07]",
            collapsed && "gap-0 p-1"
          )}
          title={companyName}
        >
          <CompanyLogo
            className={cn(
              "w-full object-contain",
              collapsed ? "h-11 w-11" : "max-h-[78px]"
            )}
          />

          {!collapsed && (
            <div className="flex w-full min-w-0 flex-col items-center">
              <div className="flex w-full max-w-full items-start justify-center gap-1">
                <span className="text-center text-xs font-bold uppercase leading-tight tracking-wide text-white break-words">
                  {companyName}
                </span>
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/75 dark:text-nav-muted" />
              </div>
              <span className="text-xs font-medium text-white/75 dark:text-nav-muted">{roleLabel}</span>
            </div>
          )}
        </button>
        {!collapsed && identity && (
          <div className="mt-1.5 flex items-center gap-2 rounded-md bg-white/[0.06] px-2 py-1.5" data-testid="sidebar-user-row">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white">{initials}</span>
            <div className="min-w-0">
              <div className="line-clamp-2 break-words leading-tight text-xs font-semibold text-white" title={identity.name}>{identity.name}</div>
              <div className="truncate text-xs text-white/75 dark:text-nav-muted">{roleLabel}</div>
            </div>
          </div>
        )}
        {mobileOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="absolute right-2 top-2 text-nav-foreground/70 hover:text-white hover:bg-white/10 lg:hidden"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>


      {/* New Lead button (hidden for techs) */}
      {!techOnly && <div className={cn("px-3 pt-2 pb-1.5", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-1.5", collapsed && "flex-col gap-1")}>
          <Button
            variant="brand"
            onClick={() => handleNav(INBOX_ROUTE)}
            className={cn("relative flex-1 min-w-0", collapsed && "w-full px-0", toneClass, tone && !collapsed && "h-auto py-1.5")}
            size={collapsed ? "icon" : "default"}
            title={hotCount > 0 ? `New Leads · ${hotCount} waiting for I'm on it` : "New Leads inbox"}
            data-tone={hotCount > 0 ? "hot" : "none"}
            data-hot-count={hotCount}
          >
            <Bell className="h-4 w-4" />
            {!collapsed && (
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="truncate">New Leads</span>
                {tone && tone.oldestMs > 0 && <span className="text-xs font-semibold opacity-90">{tone.tone === "red" ? "! " : ""}oldest {hm(tone.oldestMs)}</span>}
              </span>
            )}
            {hotCount > 0 && (
              collapsed ? (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-[#DC2626] shadow">
                  {hotLabel}
                </span>
              ) : (
                <span data-testid="new-leads-hot-count" className="ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-white px-1.5 text-xs font-extrabold text-[#DC2626]">
                  {hotLabel}
                </span>
              )
            )}
          </Button>
          <Button
            variant="brand"
            size="icon"
            onClick={() => {
              onCreateLead();
              onMobileClose?.();
            }}
            className={cn("shrink-0 bg-transparent shadow-none hover:bg-white/10", collapsed && "w-full")}
            title="Create lead"
            aria-label="Create lead"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white">
              <Plus className="h-4 w-4 text-white" strokeWidth={3} />
            </span>
          </Button>
        </div>
      </div>}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-1 space-y-px">
        {sections.map((sec) => (
          <div key={sec.title} className="space-y-px pt-1.5 first:pt-0.5" data-testid="sidebar-section">
            {!collapsed ? (
              <div className="px-3 pb-0.5 pt-1 text-xs font-bold uppercase tracking-[0.08em] text-white/70 dark:text-white/75 dark:text-nav-muted">{sec.title}</div>
            ) : (
              <div className="mx-3 my-1 border-t border-white/15" aria-hidden="true" />
            )}
            {sec.items.map((item) => renderItem(item))}
          </div>
        ))}
      </nav>

      {/* Secondary links */}
      <div className={cn("border-t border-white/15 px-2 py-1 space-y-px", collapsed && "px-1")} data-testid="settings-account-group">
        <button
          onClick={() => setAccountOpen((v) => !v)}
          aria-expanded={accountOpen}
          title="Settings & account"
          className={cn(
            "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-xs font-medium text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
            collapsed && "justify-center px-0"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && (
            <>
              <span>Settings &amp; account</span>
              <ChevronDown className={cn("ml-auto h-3.5 w-3.5 opacity-70 transition-transform", accountOpen && "rotate-180")} />
            </>
          )}
        </button>
        {accountOpen && (<>
        {[
          ...(isSalesRep || !isAdmin ? [] : [{ path: "/admin/settings", label: "Settings", icon: Settings }]),
          ...(isSalesRep || !isAdmin ? [] : [{ path: "/admin/areas", label: "Areas", icon: MapPin }]),
          { path: "/admin/my-signature", label: "My email signature", icon: Mail },
          { path: "/admin/help", label: "Help", icon: HelpCircle },
        ].map((item) => (
          <button
            key={item.path}
            onClick={() => handleNav(item.path)}
            className={cn(
              "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-xs text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
              collapsed && "justify-center px-0"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
        {isAdmin && isPlatformOwner && (
          <>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-xs text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
                collapsed && "justify-center px-0"
              )}
            >
              <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {!collapsed && (
                <>
                  <span>Advanced</span>
                  <ChevronDown className={cn("ml-auto h-3.5 w-3.5 opacity-70", advancedOpen && "rotate-180")} />
                </>
              )}
            </button>
            {advancedOpen && advancedItems.map((item) => (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md pl-7 pr-3 py-1 text-xs text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </>
        )}
        <LayoutToggleButton collapsed={collapsed} />
        <button
          onClick={() => { navigate("/admin/my-base"); onMobileClose?.(); }}
          className={cn(
            "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-xs text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
            collapsed && "justify-center px-0"
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>My hours &amp; base</span>}
        </button>
        <button
          onClick={() => {
            onSignOut();
            onMobileClose?.();
          }}
          className={cn(
            "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-xs text-white/75 dark:text-nav-muted transition-colors hover:text-white hover:bg-white/[0.06]",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>Sign Out</span>}
        </button>
        </>)}
      </div>

      {/* v7 footer row: Sign out · Collapse */}
      <div className={cn("flex items-center border-t border-white/15 p-1.5", collapsed ? "flex-col gap-1" : "justify-between")} data-testid="sidebar-footer-row">
        <button onClick={() => { onSignOut(); onMobileClose?.(); }} title="Sign out" className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white", collapsed && "justify-center px-0")}>
          <LogOut className="h-4 w-4" strokeWidth={1.75} />{!collapsed && <span>Sign out</span>}
        </button>
      <div className="hidden lg:block">
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Show panel" : "Collapse sidebar"}
          aria-label={collapsed ? "Show panel" : "Collapse sidebar"}
          className={collapsed
            ? "mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-primary/30 transition hover:scale-110 hover:bg-primary/85 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
            : "flex items-center px-2 py-1 text-white/80 hover:text-white transition-colors"}
        >
          {collapsed ? <ChevronRight className="h-5 w-5" strokeWidth={3} /> : <><ChevronLeft className="h-4 w-4" /><span className="ml-1 text-xs">Collapse</span></>}
        </button>
      </div>
      </div>
    </div>
  );

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onMobileClose} />
      )}

      <aside
        className={cn(
          "flex flex-col shrink-0 transition-all duration-300 z-50 bg-[#1590D6] dark:bg-[#08111f] border-r border-white/10",
          "hidden lg:flex h-full",
          collapsed ? "w-[64px]" : "w-[232px]",
        )}
      >
        {sidebarContent}
      </aside>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[264px] transform transition-transform duration-300 lg:hidden shadow-2xl bg-[#1590D6] dark:bg-[#08111f]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
};

export default AdminSidebar;
