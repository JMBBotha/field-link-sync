import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  X,
  Building2,
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
}

interface NavGroup {
  title: string;
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
        { path: "/admin", label: "Home", icon: LayoutDashboard },
        { path: "/admin/customers", label: "Customers", icon: Users },
        { path: "/admin/map", label: "Map", icon: MapPin },
        { path: "/admin/dispatch", label: "Dispatch", icon: LayoutGrid },
        { path: "/admin/schedule", label: "Schedule", icon: CalendarDays },
      ],
    },
    {
      title: "Sales",
      items: [
        { path: "/admin/quotes", label: "Quotes", icon: FileText },
        { path: "/admin/proposals", label: "Proposals", icon: FileSignature },
        { path: "/admin/invoices", label: "Invoices", icon: Receipt },
        { path: "/admin/invoices/templates", label: "Invoice Templates", icon: FileText },
        { path: "/admin/agreements", label: "Agreements", icon: FileCheck },
      ],
    },
    {
      title: "Operations",
      items: [
        { path: "/admin/suppliers", label: "Suppliers", icon: Building2 },
        { path: "/admin/consumables", label: "Consumables", icon: Package },
        { path: "/admin/catalog", label: "Catalog", icon: ShoppingBag },
        { path: "/admin/maintenance", label: "Maintenance", icon: CalendarDays },
        { path: "/admin/inventory", label: "Inventory", icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined },
        { path: "/admin/flat-rate", label: "Flat Rate", icon: DollarSign },
        { path: "/admin/reports", label: "Reports", icon: BarChart3 },
        { path: "/admin/reports/advanced", label: "Advanced Reports", icon: TrendingUp },
        { path: "/admin/analytics", label: "Analytics", icon: LineChart },
      ],
    },
    {
      title: "System",
      items: [
        { path: "/admin/team", label: "Team", icon: Users },
        { path: "/admin/billing", label: "Billing", icon: DollarSign },
        { path: "/admin/notifications", label: "Notifications", icon: Bell, badge: pendingRequestsCount },
        { path: "/admin/audit", label: "Audit", icon: History },
        { path: "/admin/import", label: "Import", icon: Upload },
        { path: "/admin/whatsapp", label: "WhatsApp", icon: MessageSquare },
        { path: "/admin/settings", label: "Settings", icon: Settings },
        { path: "/admin/companies", label: "Companies", icon: Building2 },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === "/admin") return location.pathname === "/admin";
    if (path === "/admin/reports") return location.pathname === "/admin/reports";
    if (path === "/admin/invoices") return location.pathname === "/admin/invoices";
    return location.pathname.startsWith(path);
  };

  const handleNav = (path: string) => {
    navigate(path);
    onMobileClose?.();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]">
      {/* Logo */}
      <div className={cn(
        "flex items-center px-4 py-5 border-b border-white/15",
        collapsed ? "justify-center px-2" : "justify-between"
      )}>
        <img src={logo} alt="Logo" className={cn("shrink-0 brightness-0 invert", collapsed ? "h-8" : "h-14")} />
        {mobileOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMobileClose}
              className="text-white/70 hover:text-white hover:bg-white/15 lg:hidden"
            >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* New Lead button */}
      <div className={cn("px-3 pt-4 pb-2", collapsed && "px-2")}>
        <Button
          onClick={() => { onCreateLead(); onMobileClose?.(); }}
          className={cn(
            "w-full bg-white text-[#0077B6] font-semibold hover:bg-white/90 shadow-md",
            collapsed && "px-0"
          )}
          size={collapsed ? "icon" : "default"}
        >
          <Plus className={cn("h-4 w-4", !collapsed && "mr-2")} />
          {!collapsed && "New Lead"}
        </Button>
      </div>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {navGroups.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/60">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.path);
                const btn = (
                  <button
                    key={item.path}
                    onClick={() => handleNav(item.path)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative",
                      active
                        ? "bg-white/20 text-white border-l-[3px] border-white pl-[calc(0.75rem-3px)]"
                        : "text-white/80 hover:text-white hover:bg-white/10",
                      collapsed && "justify-center px-0 py-2.5"
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
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className={cn("border-t border-white/15 p-3 space-y-1", collapsed && "p-2")}>
        <button
          onClick={() => { navigate("/field"); onMobileClose?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <Users className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Field Agent View</span>}
        </button>
        <button
          onClick={() => { onSignOut(); onMobileClose?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle - desktop only */}
      <div className="hidden lg:block border-t border-white/15 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-2 text-white/60 hover:text-white transition-colors"
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
          "flex flex-col shrink-0 transition-all duration-300 z-50 border-r border-white/10 shadow-xl",
          "hidden lg:flex h-full rounded-r-2xl bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]",
          collapsed ? "w-[60px]" : "w-[220px]",
        )}
      >
        {sidebarContent}
      </aside>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[260px] transform transition-transform duration-300 lg:hidden rounded-r-2xl shadow-2xl border-r border-white/10 bg-[#0077B6] dark:bg-gradient-to-b dark:from-[#070e1a] dark:via-[#153258] dark:to-[#070e1a]",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
};

export default AdminSidebar;
