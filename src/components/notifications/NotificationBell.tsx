import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import NotificationsList, { notificationHref } from "./NotificationsList";
import { markFollowUpDone } from "./notificationFollowUp";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  related_id: string | null;
  created_at: string;
}

const NotificationBell = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const fetchNotifications = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setNotifications((data as Notification[]) || []);
    };

    fetchNotifications();

    // Subscribe to realtime changes
    const channel = supabase
      .channel("user-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setNotifications((prev) => [n, ...prev].slice(0, 20));
          // Lead SLA alerts (check_lead_sla cron) also pop a toast; Open marks read + opens the lead
          if ((n.type || "").startsWith("lead_sla")) {
            toast.warning(n.title, {
              description: n.body ?? undefined,
              duration: 15000,
              action: {
                label: "Open",
                onClick: () => {
                  markFollowUpDone(n.id);
                  supabase.from("notifications").update({ read: true }).eq("id", n.id).then(() =>
                    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
                  );
                  navRef.current(notificationHref(n.type, n.related_id, window.location.pathname.startsWith("/field")));
                },
              },
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) => (n.id === (payload.new as Notification).id ? (payload.new as Notification) : n))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllRead = async (ids?: string[]) => {
    if (!userId) return;
    if (ids && ids.length === 0) return;
    let query = supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (ids) query = query.in("id", ids);
    await query;
    setNotifications((prev) =>
      prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-white hover:bg-white/20"
          onMouseEnter={() => setOpen(true)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-[10px]"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 overflow-hidden"
        align="end"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseLeave={() => setOpen(false)}
      >
        <NotificationsList
          notifications={notifications}
          onMarkAsRead={markAsRead}
          onMarkAllRead={markAllRead}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
