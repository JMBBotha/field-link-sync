import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, FileText, Briefcase, CreditCard, MessageSquare, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  related_id: string | null;
  created_at: string;
}

interface NotificationsListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}

const typeIcons: Record<string, typeof Bell> = {
  lead_assigned: Briefcase,
  new_lead: Briefcase,
  job_status_change: Briefcase,
  assignment_created: Briefcase,
  assignment_accepted: Briefcase,
  assignment_started: Briefcase,
  invoice_paid: CreditCard,
  quote_status_change: FileText,
};

type FilterKey = "all" | "quotes" | "invoices" | "jobs" | "leads";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "quotes", label: "Quotes" },
  { key: "invoices", label: "Invoices" },
  { key: "jobs", label: "Jobs" },
  { key: "leads", label: "Leads" },
];

const categoryOf = (type: string): FilterKey => {
  const t = (type || "").toLowerCase();
  if (t.includes("quote") || t.includes("estimate") || t.includes("proposal")) return "quotes";
  if (t.includes("invoice") || t.includes("payment")) return "invoices";
  if (t.includes("job") || t.includes("assignment") || t.includes("dispatch")) return "jobs";
  if (t.includes("lead")) return "leads";
  return "all";
};

export const notificationHref = (type: string, relatedId?: string | null): string => {
  const category = categoryOf(type);
  if (category === "quotes") return relatedId ? `/admin/estimates/${relatedId}` : "/admin/quotes";
  if (category === "invoices") return relatedId ? `/admin/invoices/${relatedId}` : "/admin/invoices";
  if (category === "jobs") return relatedId ? `/admin/jobs/${relatedId}` : "/admin/jobs";
  return "/admin/dispatch";
};

const NotificationsList = ({
  notifications,
  onMarkAsRead,
  onMarkAllRead,
  onClose,
}: NotificationsListProps) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    const map: Record<FilterKey, number> = { all: notifications.length, quotes: 0, invoices: 0, jobs: 0, leads: 0 };
    notifications.forEach((n) => {
      const c = categoryOf(n.type);
      if (c !== "all") map[c] += 1;
    });
    return map;
  }, [notifications]);

  const visible = useMemo(
    () => (filter === "all" ? notifications : notifications.filter((n) => categoryOf(n.type) === filter)),
    [notifications, filter]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  const openNotification = (n: Notification) => {
    if (!n.read) onMarkAsRead(n.id);
    onClose();
    navigate(notificationHref(n.type, n.related_id));
  };



  return (
    <div className="flex flex-col h-[28rem] max-h-[80vh]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={onMarkAllRead}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="shrink-0 flex gap-1 overflow-x-auto px-3 py-2 border-b">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {f.label}
            {counts[f.key] > 0 && <span className="ml-1 opacity-70">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0 h-full">
        {visible.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>{filter === "all" ? "No notifications yet" : `No ${filter} notifications`}</p>
          </div>
        ) : (
          <div className="divide-y">
            {visible.map((notification) => {

              const Icon = typeIcons[notification.type] || MessageSquare;
              return (
                <button
                  key={notification.id}
                  className={`w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex gap-3 ${
                    !notification.read ? "bg-primary/5" : ""
                  }`}
                  onClick={() => openNotification(notification)}
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                      !notification.read
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm truncate ${
                          !notification.read ? "font-semibold" : "font-medium"
                        }`}
                      >
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                      )}
                    </div>
                    {notification.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {notification.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 self-center" />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <button
        type="button"
        onClick={() => {
          onClose();
          navigate("/admin/dispatch");
        }}
        className="shrink-0 w-full px-4 py-2 text-xs font-medium text-primary hover:bg-accent/50 border-t text-left"
      >
        View all →
      </button>
    </div>
  );
};

export default NotificationsList;
