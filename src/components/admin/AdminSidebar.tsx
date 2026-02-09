import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MapPin,
  CalendarDays,
  FileText,
  FileSignature,
  Receipt,
  FileCheck,
  Package,
  DollarSign,
  BarChart3,
  LineChart,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import logo from "@/assets/logo.png";

type AdminTab =
  | "home" | "map" | "schedule"
  | "quotes" | "proposals" | "invoices" | "agreements"
  | "inventory" | "flatrate" | "reports" | "analytics"
  | "notifications" | "audit" | "import" | "settings";

interface NavItem {
  id: AdminTab;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface AdminSidebarProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onCreateLead: () => void;
  onSignOut: () => void;
  pendingRequestsCount?: number;
  /** Mobile drawer mode */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const AdminSidebar = ({
  activeTab,
  onTabChange,
  onCreateLead,
  onSignOut,
  pendingRequestsCount = 0,
  mobileOpen,
  onMobileClose,
}: AdminSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const navGroups: NavGroup[] = [
    {
      title: "Main",
      items: [
        { id: "home", label: "Home", icon: LayoutDashboard },
        { id: "map", label: "Map", icon: MapPin },
        { id: "schedule", label: "Schedule", icon: CalendarDays },
      ],
    },
    {
      title: "Sales",
      items: [
        { id: "quotes", label: "Quotes", icon: FileText },
        { id: "proposals", label: "Proposals", icon: FileSignature },
        { id: "invoices", label: "Invoices", icon: Receipt },
        { id: "agreements", label: "Agreements", icon: FileCheck },
      ],
    },
    {
      title: "Operations",
      items: [
        { id: "inventory", label: "Inventory", icon: Package },
        { id: "flatrate", label: "Flat Rate", icon: DollarSign },
        { id: "reports", label: "Reports", icon: BarChart3 },
        { id: "analytics", label: "Analytics", icon: LineChart },
      ],
    },
    {
      title: "System",
      items: [
        { id: "notifications", label: "Notifications", icon: Bell, badge: pendingRequestsCount },
        { id: "audit", label: "Audit", icon: History },
        { id: "import", label: "Import", icon: Upload },
        { id: "settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  const handleNav = (tab: AdminTab) => {
    onTabChange(tab);
    onMobileClose?.();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-5 border-b border-white/10",
        collapsed && "justify-center px-2"
      )}>
        <img src={logo} alt="Logo" className={cn("shrink-0", collapsed ? "h-8" : "h-10")} />
        {!collapsed && (
          <span className="text-white font-bold text-sm leading-tight">Admin<br />Dashboard</span>
        )}
        {/* Mobile close */}
        {mobileOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="ml-auto text-white/70 hover:text-white hover:bg-white/10 lg:hidden"
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
            "w-full bg-primary hover:bg-primary/90 text-primary-foreground",
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
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = activeTab === item.id;
                const btn = (
                  <button
                    key={item.id}
                    onClick={() => handleNav(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative",
                      isActive
                        ? "bg-primary/20 text-white border-l-[3px] border-primary pl-[calc(0.75rem-3px)]"
                        : "text-white/70 hover:text-white hover:bg-white/10",
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
                    <Tooltip key={item.id} delayDuration={0}>
                      <TooltipTrigger asChild>{btn}</TooltipTrigger>
                      <TooltipContent side="right" className="font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }
                return btn;
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className={cn("border-t border-white/10 p-3 space-y-1", collapsed && "p-2")}>
        <button
          onClick={() => { navigate("/field"); onMobileClose?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <Users className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Field Agent View</span>}
        </button>
        <button
          onClick={() => { onSignOut(); onMobileClose?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle - desktop only */}
      <div className="hidden lg:block border-t border-white/10 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-2 text-white/50 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "bg-zinc-900 flex flex-col shrink-0 transition-all duration-300 z-50",
          // Desktop
          "hidden lg:flex h-full",
          collapsed ? "w-[60px]" : "w-[220px]",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-zinc-900 w-[260px] transform transition-transform duration-300 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
};

export default AdminSidebar;
