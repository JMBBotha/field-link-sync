import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole, type AppRole } from "@/hooks/useRole";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { LayoutDashboard, CalendarDays, FileText, Receipt, Package, BarChart3, ShoppingBag, LineChart, Bell, History, Upload, Settings, Plus, Users, LogOut, ChevronLeft, ChevronRight, ChevronDown, X, Building2, Briefcase, ClipboardList, Sparkles, HelpCircle, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import logo from "@/assets/logo.png";
import { useLeadInbox, INBOX_ROUTE } from "@/hooks/useLeadInbox";

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
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
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isDispatcher, isFieldAgent, roles } = useRole();
  const { settings } = useCompanySettings();
  const { count: inboxCount } = useLeadInbox();


  const companyName = settings?.company_name?.trim() || "My Company";
  const roleLabel = isAdmin
    ? "Owner"
    : isDispatcher
      ? "Dispatcher"
      : isFieldAgent
        ? "Technician"
        : "Viewer";

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

  // FreshBooks-style ordering. Every existing route is preserved —
  // items are only regrouped/relabelled for the accounting-app layout.
  const navGroups: NavGroup[] = [
    {
      title: "Main",
      items: [
        { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
        { path: "/admin/customers", label: "Clients", icon: Users },
        {
          path: "/admin/quotes",
          label: "Quotes",
          icon: FileText,
          roles: ["admin", "dispatcher", "viewer"],
        },
        {
          path: "/admin/invoices",
          label: "Invoices",
          icon: Receipt,
          roles: ["admin", "dispatcher", "viewer"],
        },
        {
          path: "/admin/jobs/dispatch",
          label: "Jobs & Dispatch",
          icon: Briefcase,
          children: [
            { path: "/admin/jobs/dispatch", label: "Dispatch Board", icon: ClipboardList },
            { path: "/admin/schedule", label: "Schedule", icon: CalendarDays },
            { path: "/admin/my-jobs", label: "My Jobs", icon: Briefcase },
          ],
        },
        { path: "/admin/map", label: "Live Tracking", icon: Navigation },
        {
          path: "/admin/catalog",
          label: "Items",
          icon: ShoppingBag,
          roles: ["admin", "dispatcher"],
          badge: lowStockCount > 0 ? lowStockCount : undefined,
          children: [
            { path: "/admin/catalog", label: "Catalog", icon: ShoppingBag },
            { path: "/admin/inventory", label: "Stock", icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined },
            { path: "/admin/suppliers", label: "Suppliers", icon: Building2 },
          ],
        },
        { path: "/admin/team", label: "Team Members", icon: Users, roles: ["admin"] },
        {
          path: "/admin/reports",
          label: "Reports",
          icon: BarChart3,
          roles: ["admin", "dispatcher", "viewer"],
          children: [
            { path: "/admin/reports/aging", label: "Accounts Aging", icon: History },
            { path: "/admin/reports/sales-by-client", label: "Sales by Client", icon: Users },
            { path: "/admin/reports/sales-by-product", label: "Sales by Product", icon: ShoppingBag },
            { path: "/admin/reports/vat", label: "VAT Summary", icon: Receipt },
            { path: "/admin/analytics", label: "Analytics", icon: LineChart },
          ],
        },
      ],
    },
  ];

  // Footer-only advanced/legacy links — never in daily primary nav.
  const advancedItems: NavItem[] = [
    { path: "/admin/audit", label: "Audit Log", icon: History },
    { path: "/admin/import", label: "Import", icon: Upload },
    { path: "/admin/companies", label: "Companies", icon: Building2 },
    { path: "/field", label: "Field Agent View", icon: Users },
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
        const kids = item.children.filter((c) => fieldAgentOnlyPaths.has(c.path));
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

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    const base = path.split("#")[0];
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
          "w-full flex items-center gap-3 rounded-md text-[13.5px] font-medium transition-colors relative",
          collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2",
          depth > 0 && !collapsed && "pl-10 py-1.5 text-[13px]",
          active
            ? "bg-nav-active text-white font-semibold before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-white/80"
            : "text-nav-foreground/85 hover:text-white hover:bg-white/[0.07]",
        )}
      >
        <item.icon className={cn("h-[17px] w-[17px] shrink-0", active ? "opacity-100" : "opacity-80")} strokeWidth={1.75} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && item.badge && item.badge > 0 ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-[10px]">
            {item.badge > 99 ? "99+" : item.badge}
          </Badge>
        ) : null}
        {collapsed && item.badge && item.badge > 0 ? (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-destructive text-[9px] text-white font-bold px-1">
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
            className="w-full flex items-center justify-center gap-3 rounded-md px-0 py-2.5 text-[13.5px] font-medium transition-colors relative text-nav-foreground/85 hover:text-white hover:bg-white/[0.07]"
          >
            <item.icon className="h-[17px] w-[17px] shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-destructive text-[9px] text-white font-bold px-1">
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
          if (!badged) {
            setExpanded((s) => ({ ...s, [item.path]: !open }));
          }
        }}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] font-medium transition-colors relative",
          active
            ? "bg-nav-active text-white font-semibold before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r before:bg-white/80"
            : "text-nav-foreground/85 hover:text-white hover:bg-white/[0.07]",
        )}
      >
        <item.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} />
        <span className="truncate">{item.label}</span>
        {badged ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-[10px]">
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
    <div className="flex flex-col h-full bg-nav/90 backdrop-blur-xl supports-[backdrop-filter]:bg-nav/85">
      {/* Company switcher */}
      <div
        className={cn(
          "relative border-b border-nav-border px-4 py-4",
          collapsed && "px-2 py-3"
        )}
      >
        <button
          onClick={() => handleNav("/admin/settings")}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-md p-2 transition-colors hover:bg-white/[0.07]",
            collapsed && "gap-0 p-1"
          )}
          title={companyName}
        >
          <img
            src={logo}
            alt={`${companyName} logo`}
            className={cn(
              "w-full object-contain",
              collapsed ? "h-8 w-8" : "max-h-20 px-2"
            )}
          />

          {!collapsed && (
            <div className="flex w-full min-w-0 flex-col items-center">
              <div className="flex w-full max-w-full items-start justify-center gap-1">
                <span className="text-center text-[12px] font-bold uppercase leading-tight tracking-wide text-white break-words">
                  {companyName}
                </span>
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nav-muted" />
              </div>
              <span className="text-[11px] font-medium text-nav-muted">{roleLabel}</span>
            </div>
          )}
        </button>
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


      {/* New Lead button */}
      <div className={cn("px-3 pt-3 pb-2", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-1.5", collapsed && "flex-col gap-1")}>
          <Button
            variant="brand"
            onClick={() => handleNav(INBOX_ROUTE)}
            className={cn("relative flex-1 min-w-0", collapsed && "w-full px-0")}
            size={collapsed ? "icon" : "default"}
            title="New Leads inbox"
          >
            <Bell className="h-4 w-4" />
            {!collapsed && <span className="truncate">New Leads</span>}
            {inboxCount > 0 && (
              collapsed ? (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </span>
              ) : (
                <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 px-1 text-[10px]">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </Badge>
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
            className={cn("shrink-0", collapsed && "w-full")}
            title="Create lead"
            aria-label="Create lead"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {visibleGroups.map((group) => (
          <div key={group.title} className="space-y-0.5">
            {group.items.map((item) => renderItem(item))}
          </div>
        ))}
      </nav>

      {/* Secondary links */}
      <div className={cn("border-t border-nav-border px-2 py-2 space-y-px", collapsed && "px-1")}>
        {[
          { path: "/admin/settings", label: "Settings", icon: Settings },
          { path: "/admin/help", label: "Help", icon: HelpCircle },
        ].map((item) => (
          <button
            key={item.path}
            onClick={() => handleNav(item.path)}
            className={cn(
              "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] text-nav-muted transition-colors hover:text-nav-foreground hover:bg-white/[0.06]",
              collapsed && "justify-center px-0"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
        {isAdmin && (
          <>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] text-nav-muted transition-colors hover:text-nav-foreground hover:bg-white/[0.06]",
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
                  "w-full flex items-center gap-3 rounded-md pl-7 pr-3 py-1 text-[12px] text-nav-muted transition-colors hover:text-nav-foreground hover:bg-white/[0.06]",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            ))}
          </>
        )}
        <button
          onClick={() => {
            onSignOut();
            onMobileClose?.();
          }}
          className={cn(
            "w-full flex items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] text-nav-muted transition-colors hover:text-nav-foreground hover:bg-white/[0.06]",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle - desktop only */}
      <div className="hidden lg:block border-t border-nav-border p-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-1.5 text-nav-muted hover:text-nav-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
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
          "flex flex-col shrink-0 transition-all duration-300 z-50 bg-nav/90 border-r border-nav-border/60",
          "hidden lg:flex h-full",
          collapsed ? "w-[64px]" : "w-[232px]",
        )}
      >
        {sidebarContent}
      </aside>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[264px] transform transition-transform duration-300 lg:hidden shadow-2xl bg-nav/95",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
};

export default AdminSidebar;
