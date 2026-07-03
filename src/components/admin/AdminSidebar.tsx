import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole, type AppRole } from "@/hooks/useRole";
import {
  LayoutDashboard,
  MapPin,
  MessageSquare,
  CalendarDays,
  LayoutGrid,
  FileText,
  FileSignature,
  Receipt,
  FileCheck,
  Package,
  DollarSign,
  BarChart3,
  ShoppingBag,
  LineChart,
  TrendingUp,
  Bell,
  History,
  Upload,
  Settings,
  Plus,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Building2,
  Briefcase,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import logo from "@/assets/logo.png";

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
  pendingRequestsCount = 0,
  mobileOpen,
  onMobileClose,
}: AdminSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isDispatcher, isFieldAgent, roles } = useRole();

  const { data: lowStockCount = 0 } = useQuery({
    queryKey: ["low-stock-count-sidebar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("quantity, low_stock_threshold, stock_mode");
      if (error) return 0;
      return (data || []).filter(
        (r: any) => r.stock_mode === "stock_sensitive" && r.quantity <= r.low_stock_threshold
      ).length;
    },
    refetchInterval: 60000,
  });

  const navGroups: NavGroup[] = [
    {
      title: "Main",
      items: [
        { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
        { path: "/admin/dispatch", label: "Leads", icon: Sparkles },
        { path: "/admin/customers", label: "Customers", icon: Users },
        {
          path: "/admin/jobs",
          label: "Jobs",
          icon: Briefcase,
          children: [
            { path: "/admin/jobs/dispatch", label: "Dispatch Board", icon: ClipboardList },
            { path: "/admin/schedule", label: "Schedule", icon: CalendarDays },
            { path: "/admin/my-jobs", label: "My Jobs", icon: Briefcase },
            { path: "/admin/map", label: "Map", icon: MapPin },
            { path: "/admin/maintenance", label: "Maintenance", icon: CalendarDays, roles: ["admin", "dispatcher"] },
          ],
        },
      ],
    },
    {
      title: "Sales",
      roles: ["admin", "dispatcher", "viewer"],
      items: [
        { path: "/admin/quotes", label: "Quotes", icon: FileText },
        { path: "/admin/agreements", label: "Agreements", icon: FileCheck },
        { path: "/admin/invoices", label: "Invoices", icon: Receipt },
        { path: "/admin/templates", label: "Templates", icon: FileSignature },
      ],
    },
    {
      title: "Operations",
      roles: ["admin", "dispatcher"],
      items: [
        {
          path: "/admin/inventory",
          label: "Inventory",
          icon: Package,
          badge: lowStockCount > 0 ? lowStockCount : undefined,
          children: [
            { path: "/admin/inventory", label: "Stock", icon: Package },
            { path: "/admin/catalog", label: "Catalog", icon: ShoppingBag },
            { path: "/admin/consumables", label: "Consumables", icon: Package },
          ],
        },
        { path: "/admin/suppliers", label: "Suppliers", icon: Building2 },
        { path: "/admin/flat-rate", label: "Pricing", icon: DollarSign },
        {
          path: "/admin/pdf-documents",
          label: "Resources",
          icon: FileText,
          children: [
            { path: "/admin/pdf-documents", label: "PDF Documents", icon: FileText },
            { path: "/admin/brochures", label: "Brochures", icon: FileText },
          ],
        },
      ],
    },
    {
      title: "Reports",
      roles: ["admin", "dispatcher", "viewer"],
      items: [
        { path: "/admin/reports", label: "Reports", icon: BarChart3 },
        { path: "/admin/analytics", label: "Analytics", icon: LineChart },
        { path: "/admin/reports/advanced", label: "Advanced", icon: TrendingUp, roles: ["admin"] },
      ],
    },
    {
      title: "System",
      roles: ["admin"],
      items: [
        { path: "/admin/team", label: "Team", icon: Users },
        { path: "/admin/billing", label: "Billing", icon: DollarSign },
        { path: "/admin/notifications", label: "Notifications", icon: Bell, badge: pendingRequestsCount },
        { path: "/admin/audit", label: "Audit", icon: History },
        { path: "/admin/import", label: "Import", icon: Upload },
        { path: "/admin/whatsapp", label: "WhatsApp", icon: MessageSquare },
        { path: "/admin/companies", label: "Companies", icon: Building2 },
        { path: "/admin/settings", label: "Settings", icon: Settings },
        { path: "/field", label: "Field Agent View", icon: Users },
      ],
    },
  ];


  const hasRole = (allowed?: AppRole[]) => {
    if (!allowed || allowed.length === 0) return true;
    return allowed.some((r) => roles.includes(r));
  };

  // Field agents get a minimal focused view: Dashboard, Jobs (My Jobs, Schedule, Map)
  const fieldAgentOnlyPaths = new Set([
    "/admin",
    "/admin/jobs",
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
    return item;
  };

  const visibleGroups = navGroups
    .filter((g) => hasRole(g.roles))
    .map((g) => ({ ...g, items: g.items.map(filterItem).filter(Boolean) as NavItem[] }))
    .filter((g) => g.items.length > 0);

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  const isGroupActive = (item: NavItem) =>
    isActive(item.path) || (item.children?.some((c) => isActive(c.path)) ?? false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (item: NavItem) =>
    expanded[item.path] ?? isGroupActive(item);

  const handleNav = (path: string) => {
    navigate(path);
    onMobileClose?.();
  };

  const renderLeaf = (item: NavItem, depth = 0) => {
    const active = isActive(item.path);
    const btn = (
      <button
        onClick={() => handleNav(item.path)}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors relative",
          collapsed ? "justify-center px-0 py-2.5" : "px-3 py-1.5",
          depth > 0 && !collapsed && "pl-9 py-1 text-[13px]",
          active
            ? "bg-primary-foreground/20 text-primary-foreground border-l-[3px] border-primary-foreground pl-[calc(0.75rem-3px)]"
            : "text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10",
          depth > 0 && active && !collapsed && "pl-[calc(2.25rem-3px)]",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && item.badge && item.badge > 0 ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-[10px]">
            {item.badge > 99 ? "99+" : item.badge}
          </Badge>
        ) : null}
        {collapsed && item.badge && item.badge > 0 ? (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-destructive text-[9px] text-primary-foreground font-bold px-1">
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
    if (collapsed) {
      // In collapsed mode, render just the parent as a link with tooltip
      return renderLeaf(item);
    }
    return (
      <div key={item.path}>
        <button
          onClick={() =>
            setExpanded((s) => ({ ...s, [item.path]: !open }))
          }
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            active
              ? "text-primary-foreground bg-primary-foreground/10"
              : "text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 ml-auto transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="mt-0.5 space-y-px">
            {item.children.map((c) => renderLeaf(c, 1))}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]">
      {/* Logo */}
      <div className={cn(
        "flex items-center px-4 py-5 border-b border-primary-foreground/15",
        collapsed ? "justify-center px-2" : "justify-between"
      )}>
        <img src={logo} alt="Logo" className={cn("shrink-0 brightness-0 invert", collapsed ? "h-8" : "h-14")} />
        {mobileOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/15 lg:hidden"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* New Lead button - prominent */}
      <div className={cn("px-3 pt-4 pb-3", collapsed && "px-2")}>
        <Button
          onClick={() => { onCreateLead(); onMobileClose?.(); }}
          className={cn(
            "w-full bg-primary-foreground text-[#0077B6] font-semibold hover:bg-primary-foreground/90 shadow-md",
            collapsed && "px-0"
          )}
          size={collapsed ? "icon" : "default"}
        >
          <Plus className={cn("h-4 w-4", !collapsed && "mr-2")} />
          {!collapsed && "New Lead"}
        </Button>
      </div>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
        {visibleGroups.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/50">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => renderItem(item))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className={cn("border-t border-primary-foreground/15 p-3 space-y-1", collapsed && "p-2")}>
        <button
          onClick={() => { onSignOut(); onMobileClose?.(); }}

          className={cn(
            "w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13px] text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle - desktop only */}
      <div className="hidden lg:block border-t border-primary-foreground/15 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-2 text-primary-foreground/60 hover:text-primary-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "flex flex-col shrink-0 transition-all duration-300 z-50 border-r border-primary-foreground/10 shadow-xl",
          "hidden lg:flex h-full rounded-r-2xl bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]",
          collapsed ? "w-[60px]" : "w-[220px]",
        )}
      >
        {sidebarContent}
      </aside>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[260px] transform transition-transform duration-300 lg:hidden rounded-r-2xl shadow-2xl border-r border-primary-foreground/10 bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
};

export default AdminSidebar;
