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
import { ACCEPT_ALERT_TYPE, resultMessage, sendInvoiceNow } from "@/lib/invoiceSendApproval";
import NotificationsList, { notificationHref } from "./NotificationsList";
import { markFollowUpDone } from "./notificationFollowUp";
import { useRole } from "@/hooks/useRole";
import SoundControls from "./SoundControls";
import { useHeartbeatAudience } from "@/hooks/useSalesHeartbeat";

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
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const techOnly = isFieldAgent && !isAdmin && !isDispatcher;
  navRef.current = navigate;
  const { canSee: hearsSounds } = useHeartbeatAudience();

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
      let list = (data as Notification[]) || [];
      // Follow-up nudges for quotes that are accepted / option not chosen / closed no longer show (old data too).
      const fu = list.filter((n) => n.type === "sales_nudge" && (n as any).metadata?.stage === "followup" && n.related_id);
      if (fu.length) {
        const { data: qs } = await (supabase as any).from("quotes").select("id, followup_state, status").in("id", fu.map((n) => n.related_id));
        const done = new Set(((qs as any[]) || []).filter((q) => q.followup_state === "closed" || ["accepted", "option_not_chosen", "declined", "superseded", "void"].includes(q.status)).map((q) => q.id));
        list = list.filter((n) => !(fu.includes(n) && done.has(n.related_id!)));
      }
      setNotifications(list);
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
          // Quote accepted: tell the rep/admin straight away and offer to send the deposit invoice now
          if (n.type === ACCEPT_ALERT_TYPE) {
            const invoiceId = (n as any).metadata?.invoice_id || n.related_id;
            const markRead = () => {
              markFollowUpDone(n.id);
              supabase.from("notifications").update({ read: true }).eq("id", n.id).then(() =>
                setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
              );
            };
            toast.success(n.title, {
              description: n.body ?? undefined,
              duration: 30000,
              action: invoiceId ? {
                label: "Send invoice now",
                onClick: async () => {
                  markRead();
                  try { const m = resultMessage(await sendInvoiceNow(invoiceId)); (m.ok ? toast.success : toast.error)(m.text); }
                  catch (e: any) { toast.error(e?.message || "Could not send the invoice"); }
                },
              } : undefined,
              cancel: { label: "Review", onClick: () => { markRead(); navRef.current(notificationHref(n.type, n.related_id)); } },
            });
          }
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
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
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
          hideLeadsFilter={techOnly}
          onMarkAsRead={markAsRead}
          onMarkAllRead={markAllRead}
          onClose={() => setOpen(false)}
        />
        {hearsSounds && <div className="border-t p-3"><SoundControls compact /></div>}
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
