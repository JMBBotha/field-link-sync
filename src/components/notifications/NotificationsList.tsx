import { useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Bell, CheckCheck, FileText, Briefcase, CreditCard, MessageSquare, ChevronRight, Check, Lock, Phone, UserPlus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import CallRecordingPlayer from "@/components/calls/CallRecordingPlayer";
import InvoiceApprovalActions from "@/components/invoicing/InvoiceApprovalActions";
import { ACCEPT_ALERT_TYPE, SEND_BLOCKED_TYPE } from "@/lib/invoiceSendApproval";
import { groupNotifications } from "./groupNotifications";
import { canMarkRead, getFollowUpIds, markFollowUpDone, requiresFollowUp } from "./notificationFollowUp";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  related_id: string | null;
  created_at: string;
  metadata?: Record<string, any> | null;
}

interface NotificationsListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: (ids?: string[]) => void;
  onClose: () => void;
  /** Techs never see the Leads filter (lead rule, 13 Oct). */
  hideLeadsFilter?: boolean;
  /** Signed-in role for tap targets (sales reps never go to the office dispatch board). */
  role?: "admin" | "sales" | "tech";
}

const typeIcons: Record<string, typeof Bell> = {
  lead_assigned: Briefcase,
  new_lead: Briefcase,
  network_applicant: UserPlus,
  job_status_change: Briefcase,
  assignment_created: Briefcase,
  assignment_accepted: Briefcase,
  assignment_started: Briefcase,
  invoice_paid: CreditCard,
  [ACCEPT_ALERT_TYPE]: CreditCard,
  [SEND_BLOCKED_TYPE]: CreditCard,
  invoice_ready: CreditCard,
  deposit_paid: CreditCard,
  quote_status_change: FileText,
  call_logged: Phone,
  appointment_reschedule_request: MessageSquare,
  appointment_cancellation_request: MessageSquare,
  whatsapp_customer_message: MessageSquare,
};

const CHANGE_REQUEST_TYPES = new Set([
  "appointment_reschedule_request",
  "appointment_cancellation_request",
]);


type FilterKey = "all" | "quotes" | "invoices" | "jobs" | "leads" | "calls";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "quotes", label: "Quotes" },
  { key: "invoices", label: "Invoices" },
  { key: "jobs", label: "Jobs" },
  { key: "leads", label: "Leads" },
  { key: "calls", label: "Calls" },
];

const categoryOf = (type: string): FilterKey => {
  const t = (type || "").toLowerCase();
  if (CHANGE_REQUEST_TYPES.has(t) || t === "whatsapp_customer_message") return "leads";
  if (t === ACCEPT_ALERT_TYPE || t === SEND_BLOCKED_TYPE) return "invoices";
  if (t.includes("call")) return "calls";
  if (t.includes("quote") || t.includes("estimate") || t.includes("proposal")) return "quotes";
  if (t.includes("invoice") || t.includes("payment")) return "invoices";
  if (t.includes("job") || t.includes("assignment") || t.includes("dispatch")) return "jobs";
  if (t.includes("lead")) return "leads";
  return "all";
};

// These bells carry a LEAD id in related_id (DB triggers) → open that lead's Job Details sheet
const LEAD_ID_TYPES = new Set(["job_status_change", "lead_assigned", "new_lead", "job_schedule", "entity_update"]);

const scrollToHash = (id: string, tries = 15) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (tries > 0) setTimeout(() => scrollToHash(id, tries - 1), 200);
};

/** 0026: the single accept alert carries the old "hand to technician" link (visit, or estimate when no visit). */
export function handoverLinkOf(n: { type: string; metadata?: any }): string | null {
  if (n.type !== ACCEPT_ALERT_TYPE) return null;
  const l = n.metadata?.handover_link;
  return typeof l === "string" && /^\/admin\/(visits|estimates)\/[\w-]+$/.test(l) ? l : null;
}

export type NotifRole = "admin" | "sales" | "tech";

/** Where "View all" goes for each role. */
export const viewAllHref = (role: NotifRole) => (role === "tech" ? "/field" : role === "sales" ? "/admin" : "/admin/dispatch");

const isLeadType = (t: string) => LEAD_ID_TYPES.has(t) || t.startsWith("lead_") || t.includes("sla");

/** Target for a bell tap. `isTech` may be a boolean (old callers) or a role. Sales reps never land on the
 *  office dispatch board (hidden for them, so lead bells did nothing): lead/job bells open their My jobs item. */
export const notificationHref = (type: string, relatedId?: string | null, isTech: boolean | NotifRole = false): string => {
  const t = (type || "").toLowerCase();
  const role: NotifRole = isTech === true ? "tech" : isTech === false ? "admin" : isTech;
  if (role === "sales") {
    if (t === ACCEPT_ALERT_TYPE || t === SEND_BLOCKED_TYPE) return relatedId ? `/admin/invoices/${relatedId}` : "/admin/invoices";
    if (t === "deposit_paid") return relatedId ? `/admin/estimates/${relatedId}` : "/admin/quotes";
    if (isLeadType(t) || CHANGE_REQUEST_TYPES.has(t) || t === "sales_nudge") return relatedId ? `/admin?myjob=${relatedId}` : "/admin";
  }
  if (role === "tech") isTech = true; else isTech = false;
  if (isTech) {
    // Lead-id bells carry a LEAD id, not a job id: /field (the list resolves lead -> job on tap)
    if (LEAD_ID_TYPES.has(t)) return "/field";
    // Techs never land on /admin: job/assignment bells open the tech job sheet, everything else /field
    if (relatedId && t !== "job_status_change" && categoryOf(t) === "jobs") return `/field/jobs/${relatedId}`;
    return "/field";
  }
  if (t === "unit_content_draft") return "/admin/unit-content";
  if (t === "special_ending") return relatedId ? `/admin/specials?edit=${relatedId}` : "/admin/specials";
  // Accepted-quote alerts carry the INVOICE id in related_id
  if (t === ACCEPT_ALERT_TYPE || t === SEND_BLOCKED_TYPE) return relatedId ? `/admin/invoices/${relatedId}` : "/admin/invoices";
  if (t === "deposit_paid") return relatedId ? `/admin/estimates/${relatedId}` : "/admin/quotes";
  if (isLeadType(t)) return relatedId ? `/admin/dispatch?lead=${relatedId}` : "/admin/dispatch";
  if ((type || "").startsWith("network_")) return "/admin/team?tab=applications";
  if (CHANGE_REQUEST_TYPES.has((type || "").toLowerCase())) return "/admin/change-requests";
  const category = categoryOf(type);
  if (category === "calls") return "/admin/calls";
  if (type === "invoice_ready") return "/admin#ready-to-invoice";

  if (category === "quotes") return relatedId ? `/admin/estimates/${relatedId}` : "/admin/quotes";
  if (category === "invoices") return relatedId ? `/admin/invoices/${relatedId}` : "/admin/invoices";
  if (category === "jobs") return relatedId ? `/admin/jobs/${relatedId}` : "/admin/jobs";
  return role === "sales" ? "/admin" : "/admin/dispatch";
};

/** Which table an /admin/... target reads, so we can tell "no access" apart from "opened". */
const accessTarget = (href: string): { table: string; id: string } | null => {
  const path = href.split(/[?#]/)[0];
  const lead = href.match(/[?&](?:lead|myjob)=([\w-]+)/);
  if (lead) return { table: "leads", id: lead[1] };
  const m = path.match(/^\/admin\/(jobs|estimates|invoices|visits|customers)\/([\w-]+)$/);
  if (!m) return null;
  const table = { jobs: "jobs", estimates: "quotes", invoices: "invoices", visits: "leads", customers: "customers" }[m[1]]!;
  return { table, id: m[2] };
};

/** RLS check: null row => the signed-in role can't open it. Errors fall through (don't block on a hiccup). */
export async function canOpenHref(href: string): Promise<boolean> {
  const t = accessTarget(href);
  if (!t) return true;
  const { data, error } = await (supabase.from as any)(t.table).select("id").eq("id", t.id).maybeSingle();
  if (error) return true;
  return !!data;
}

const NO_ACCESS = "You don't have access to this one.";

/** sales_nudge carries a lead OR a quote id (metadata.entity). */
const effectiveType = (n: { type: string; metadata?: any }) =>
  n.type === "sales_nudge" ? (n.metadata?.entity === "quote" ? "quote_status_change" : "lead_assigned") : n.type;

/** Final target for a tap: role-aware href, plus lead -> job lookup for techs. */
export async function resolveHref(n: { type: string; related_id: string | null; metadata?: any }, role: NotifRole): Promise<string> {
  const href = notificationHref(effectiveType(n), n.related_id, role);
  if (role === "tech" && n.related_id && LEAD_ID_TYPES.has((n.type || "").toLowerCase())) {
    const { data } = await (supabase.from as any)("jobs").select("id").eq("lead_id", n.related_id).order("created_at", { ascending: false }).limit(1);
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (id) return `/field/jobs/${id}`;
  }
  return href;
}

const NotificationsList = ({
  notifications,
  onMarkAsRead,
  onMarkAllRead,
  onClose,
  hideLeadsFilter,
  role: roleProp,
}: NotificationsListProps) => {
  const navigate = useNavigate();
  const role: NotifRole = roleProp ?? (window.location.pathname.startsWith("/field") ? "tech" : "admin");
  const [openBody, setOpenBody] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [followUps, setFollowUps] = useState<Set<string>>(() => getFollowUpIds());
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const counts = useMemo(() => {
    const map: Record<FilterKey, number> = { all: notifications.length, quotes: 0, invoices: 0, jobs: 0, leads: 0, calls: 0 };
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
  const eligibleUnread = useMemo(
    () => notifications.filter((n) => !n.read && canMarkRead(n, followUps)),
    [notifications, followUps]
  );
  const blockedCount = unreadCount - eligibleUnread.length;

  const openNotification = (n: Notification) => {
    markFollowUpDone(n.id);
    setFollowUps((prev) => new Set(prev).add(n.id));
    if (!n.read) onMarkAsRead(n.id);
    onClose();
    resolveHref(n, role).then(go);
  };

  const go = async (href: string) => {
    if (!(await canOpenHref(href))) { toast.error(NO_ACCESS); return; }
    navigate(href);
    const hash = href.split("#")[1];
    if (hash) scrollToHash(hash);
  };

  /** Client name in a grouped card -> that client's page (id from metadata, else a name lookup under RLS). */
  const openClient = async (key: string, label: string, items: Notification[]) => {
    items.forEach((x) => { if (!x.read && canMarkRead(x, followUps)) onMarkAsRead(x.id); });
    onClose();
    // Techs have no client pages: the name opens their newest job for this client.
    if (role === "tech") { go(await resolveHref(items[0], role)); return; }
    let id = key.startsWith("c:") ? key.slice(2) : (items.find((x) => x.metadata?.customer_id)?.metadata?.customer_id as string | undefined);
    if (!id && label) {
      const { data } = await supabase.from("customers").select("id").ilike("name", label.replace(/[%_]/g, "")).limit(1);
      id = (data as { id: string }[] | null)?.[0]?.id;
    }
    if (!id) { toast.error("Couldn't find this client, or you don't have access."); return; }
    go(`/admin/customers/${id}`);
  };

  const quickMarkRead = (n: Notification) => {
    if (n.read || !canMarkRead(n, followUps)) return;
    onMarkAsRead(n.id);
    setSwipeId(null);
    setSwipeX(0);
  };

  const resetSwipe = () => {
    setSwipeId(null);
    setSwipeX(0);
    touchStart.current = null;
  };

  const renderRow = (notification: Notification) => {
                const Icon = typeIcons[notification.type] || MessageSquare;
                const allowed = canMarkRead(notification, followUps);
                const offset = swipeId === notification.id ? swipeX : 0;
                return (
                  <div key={notification.id} className="relative overflow-hidden">
                    {/* Swipe reveal background */}
                    <div
                      className={`absolute inset-y-0 left-0 flex items-center gap-1.5 px-3 text-xs font-medium ${
                        allowed ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {allowed ? <Check className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
                      {allowed ? "Read" : "Follow up first"}
                    </div>

                    <div
                      className="relative bg-background transition-transform"
                      style={{ transform: `translateX(${offset}px)` }}
                      onTouchStart={(e) => {
                        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                        setSwipeId(notification.id);
                      }}
                      onTouchMove={(e) => {
                        if (!touchStart.current) return;
                        const dx = e.touches[0].clientX - touchStart.current.x;
                        const dy = Math.abs(e.touches[0].clientY - touchStart.current.y);
                        if (dy > 24) return resetSwipe();
                        setSwipeX(Math.max(0, Math.min(dx, 96)));
                      }}
                      onTouchEnd={() => {
                        if (swipeX > 64 && !notification.read && allowed) quickMarkRead(notification);
                        resetSwipe();
                      }}
                    >
                      <button
                        className={`group w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex gap-3 ${
                          !notification.read ? "bg-primary/10" : ""
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
                              className={`text-sm leading-snug text-foreground break-words ${
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
                            <>
                              <p data-testid="notif-body" className={`text-[13px] leading-snug text-foreground/80 mt-0.5 break-words ${notification.type === "call_logged" ? "whitespace-pre-line" : ""} ${openBody.has(notification.id) ? "" : "line-clamp-3"}`}>
                                {notification.body}
                              </p>
                              {notification.body.length > 110 && (
                                <span role="button" tabIndex={0} data-testid="notif-more"
                                  className="mt-0.5 inline-block text-xs font-medium text-primary"
                                  onClick={(e) => { e.stopPropagation(); setOpenBody((p) => { const x = new Set(p); x.has(notification.id) ? x.delete(notification.id) : x.add(notification.id); return x; }); }}>
                                  {openBody.has(notification.id) ? "Show less" : "Show more"}
                                </span>
                              )}
                            </>
                          )}
                          <p className="text-xs text-foreground/60 mt-1">
                            {formatDistanceToNow(new Date(notification.created_at), {
                              addSuffix: true,
                            })}
                            {!notification.read && requiresFollowUp(notification.type) && !allowed && (
                              <span className="ml-2 text-amber-600 dark:text-amber-500">Needs follow-up</span>
                            )}
                          </p>
                          {notification.type === ACCEPT_ALERT_TYPE && !notification.read && (notification.metadata?.invoice_id || notification.related_id) && (
                            <InvoiceApprovalActions className="mt-2 flex flex-wrap gap-1"
                              invoiceId={notification.metadata?.invoice_id || notification.related_id!}
                              onDone={() => { markFollowUpDone(notification.id); setFollowUps((prev) => new Set(prev).add(notification.id)); onMarkAsRead(notification.id); }} />
                          )}
                          {handoverLinkOf(notification) && (
                            <button type="button" data-testid="hand-to-technician"
                              className="mt-1 inline-flex items-center text-xs font-medium text-primary hover:underline"
                              onClick={(e) => { e.stopPropagation(); onClose?.(); navigate(handoverLinkOf(notification)!); }}>
                              <Wrench className="mr-1 h-3 w-3" />Hand to technician
                            </button>
                          )}
                          {notification.type === "call_logged" && (
                            <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                              <CallRecordingPlayer callId={notification.related_id} />
                              <button type="button" data-testid="view-transcript"
                                className="text-xs font-medium text-primary hover:underline"
                                onClick={() => { const leadId = (notification as any).metadata?.lead_id; onClose?.(); go(leadId ? notificationHref("lead_assigned", leadId, role) : "/admin/calls"); }}>
                                View transcript
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Quick actions */}
                        <div className="flex items-center gap-1 shrink-0 self-center">
                          {!notification.read && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label="Mark as read"
                                  aria-disabled={!allowed}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    quickMarkRead(notification);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      quickMarkRead(notification);
                                    }
                                  }}
                                  className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors sm:opacity-0 sm:group-hover:opacity-100 ${
                                    allowed
                                      ? "text-primary hover:bg-primary/10"
                                      : "text-muted-foreground/60 cursor-not-allowed"
                                  }`}
                                >
                                  {allowed ? <Check className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[14rem] text-xs">
                                {allowed
                                  ? "Mark as read"
                                  : "Open this notification and handle the follow-up before marking it read"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </button>
                    </div>
                  </div>
                );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-[min(34rem,calc(100dvh-5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] sm:h-[28rem] sm:max-h-[80vh]">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    disabled={eligibleUnread.length === 0}
                    onClick={() => onMarkAllRead(eligibleUnread.map((n) => n.id))}
                  >
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Mark all read
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[15rem] text-xs">
                {blockedCount > 0
                  ? `${blockedCount} notification${blockedCount > 1 ? "s" : ""} still need follow-up — open them first.`
                  : `Marks ${eligibleUnread.length} notification${eligibleUnread.length === 1 ? "" : "s"} as read.`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Filters */}
        <div className="relative shrink-0 border-b">
        <div data-testid="notif-tabs" className="flex gap-1 overflow-x-auto px-3 py-2 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.filter((f) => !(hideLeadsFilter && f.key === "leads")).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground/80 hover:bg-accent"
              }`}
            >
              {f.label}
              {counts[f.key] > 0 && <span className="ml-1 opacity-70">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-popover to-transparent" />
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
              {groupNotifications(visible).map((g) => {
                if (g.items.length === 1) return <div key={g.items[0].id}>{renderRow(g.items[0])}</div>;
                const latest = g.items[0];
                const isOpen = expanded.has(g.key);
                const unread = g.items.filter((x) => !x.read).length;
                return (
                  <div key={g.key} data-testid="notif-group">
                    <div role="button" tabIndex={0} aria-expanded={isOpen}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((prev) => { const n = new Set(prev); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; }); } }}
                      onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                      className={`relative w-full cursor-pointer text-left px-4 py-3 hover:bg-accent/50 transition-colors flex gap-3 ${unread ? "bg-primary/10" : ""}`}>
                      <div className="relative h-8 w-8 shrink-0">
                        <span className="absolute inset-0 translate-x-1 -translate-y-1 rounded-full bg-muted" />
                        <span className={`absolute inset-0 rounded-full flex items-center justify-center text-[11px] font-bold ${unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{g.items.length}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" data-testid="notif-client-link"
                            onClick={(e) => { e.stopPropagation(); openClient(g.key, g.label, g.items); }}
                            className={`min-w-0 break-words text-left text-sm text-foreground underline decoration-primary/40 underline-offset-2 hover:text-primary ${unread ? "font-semibold" : "font-medium"}`}>{g.label}</button>
                          <span className="shrink-0 text-[11px] text-foreground/60">{g.items.length} updates{unread ? ` · ${unread} new` : ""}</span>
                        </div>
                        <p className="text-[13px] leading-snug text-foreground/80 mt-0.5 line-clamp-3 break-words">{latest.title}{latest.body ? ` · ${latest.body}` : ""}</p>
                        <p className="text-xs text-foreground/60 mt-1">{formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}</p>
                      </div>
                      <ChevronRight className={`h-3.5 w-3.5 self-center text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </div>
                    {isOpen && <div className="border-l-2 border-primary/30 ml-4 divide-y">{g.items.map((x) => <div key={x.id}>{renderRow(x)}</div>)}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <button
          type="button"
          onClick={() => {
            onClose();
            navigate(viewAllHref(role));
          }}
          data-testid="notif-view-all"
          className="shrink-0 w-full px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-xs font-medium text-primary hover:bg-accent/50 border-t text-left"
        >
          View all →
        </button>
      </div>
    </TooltipProvider>
  );
};

export default NotificationsList;
