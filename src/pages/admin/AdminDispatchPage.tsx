import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useLeadInbox } from "@/hooks/useLeadInbox";
import { useLaneStaff } from "@/hooks/useLaneStaff";
import { laneOf, leadLaneFields, LANE_META, UNKNOWN_LANE_META, type LeadLane } from "@/lib/leadLane";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import { usePresence } from "@/hooks/usePresence";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import EntityDetailsForm from "@/components/entity/EntityDetailsForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  CalendarDays, Clock, MapPin, Search, Users, AlertTriangle, Wifi, WifiOff,
  GripVertical, ChevronRight, ChevronLeft, Loader2, Filter, Zap, Phone, User, FileText, Info
} from "lucide-react";
import { format, addDays, startOfWeek, endOfWeek, isToday, isSameDay, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getMapboxToken, getMapboxTokenSync } from "@/lib/mapboxToken";
import { KpiGridSkeleton, JobCardListSkeleton } from "@/components/ui/skeletons";

// ─── Types ───
interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  priority: string;
  latitude: number;
  longitude: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  assigned_agent_id: string | null;
  primary_intent?: string | null;
  customer_id?: string | null;
  notes: string | null;
  created_at: string | null;
}

interface Agent {
  id: string;
  full_name: string;
  availability_status: string | null;
}

interface AgentLocation {
  agent_id: string;
  latitude: number;
  longitude: number;
  is_available: boolean | null;
  last_updated: string | null;
}

interface Schedule {
  id: string;
  lead_id: string;
  agent_id: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  leads?: { customer_name: string; service_type: string; status: string; priority: string; customer_address: string; latitude: number; longitude: number } | null;
}

// ─── Constants ───
const STATUS_COLORS: Record<string, string> = {
  pending: "hsl(38, 92%, 50%)",
  accepted: "hsl(217, 91%, 60%)",
  in_progress: "hsl(142, 76%, 36%)",
  completed: "hsl(220, 9%, 46%)",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "destructive",
  high: "destructive",
  medium: "default",
  normal: "secondary",
  low: "outline",
};

const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6AM–20PM

// ─── Helpers ───
/** Placeholder strings written by intake bots when no address was captured yet. */
const isPlaceholderAddress = (address?: string | null) =>
  !address || /^address (pending|to be confirmed)/i.test(address.trim());

const displayAddress = (address?: string | null) =>
  isPlaceholderAddress(address) ? "Address pending" : String(address);

const getSuburb = (address: string) => {
  if (isPlaceholderAddress(address)) return "Address pending";
  const parts = address.split(",").map(s => s.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
};

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

const minutesToPx = (mins: number, pxPerHour: number) => (mins / 60) * pxPerHour;

// ─── Component ───
const AdminDispatchPage = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOnline: isPresenceOnline } = usePresence("dispatch-presence");
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const inboxMode = searchParams.get("inbox") === "1";
  const { leads: inboxLeads } = useLeadInbox();
  const { salesStaff, technicians, laneById } = useLaneStaff();
  const [showCreateLead, setShowCreateLead] = useState(false);

  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [draggingLead, setDraggingLead] = useState<Lead | null>(null);
  const [showMapPane, setShowMapPane] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickAssignLead, setQuickAssignLead] = useState<Lead | null>(null);
  const [quickAssignAgent, setQuickAssignAgent] = useState("");
  const [quickAssignDate, setQuickAssignDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quickAssignStart, setQuickAssignStart] = useState("08:00");
  const [quickAssignEnd, setQuickAssignEnd] = useState("10:00");
  const [jobInfoLead, setJobInfoLead] = useState<Lead | null>(null);
  const [jobInfoSchedule, setJobInfoSchedule] = useState<Schedule | null>(null);

  // Sales job → quote. The quote-builder resolver opens the latest
  // non-superseded quote for this lead or creates a draft hung on it.
  const openQuoteForLead = useCallback((lead: Lead) => {
    const params = new URLSearchParams({ leadId: lead.id });
    if (lead.customer_id) params.set("customerId", lead.customer_id);
    navigate(`/admin/quote-builder?${params.toString()}`);
  }, [navigate]);

  // Multi-select & drag-drop state
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [shakeSlot, setShakeSlot] = useState<string | null>(null);

  const PX_PER_HOUR = 80;

  // ─── Data queries ───
  const { data: allLeads = [], isLoading: leadsLoading, isError: leadsError } = useQuery({
    queryKey: ["dispatch-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .is("deleted_at", null)
        .in("status", ["pending", "accepted", "in_progress"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Lead[];
    },
    meta: {
      onError: (err: Error) => toast({ title: "Failed to load jobs", description: err.message, variant: "destructive" }),
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["dispatch-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "field_agent");
      if (!roles?.length) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, availability_status")
        .in("id", roles.map((r: any) => r.user_id));
      return (profiles || []) as Agent[];
    },
  });

  /**
   * Calendar staff rows = sales people AND technicians for this company.
   * Sales people are staff on dispatch, not techs-only.
   */
  const dispatchAgents = useMemo<Agent[]>(() => {
    const byId = new Map<string, Agent>();
    [...salesStaff, ...technicians].forEach(s =>
      byId.set(s.id, { id: s.id, full_name: s.full_name, availability_status: s.availability_status }),
    );
    agents.forEach(a => { if (!byId.has(a.id)) byId.set(a.id, a); });
    return Array.from(byId.values()).sort((a, b) => {
      const laneA = laneRank(laneById.get(a.id) ?? null);
      const laneB = laneRank(laneById.get(b.id) ?? null);
      if (laneA !== laneB) return laneA - laneB;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [salesStaff, technicians, agents, laneById]);

  const { data: agentLocations = [] } = useQuery({
    queryKey: ["dispatch-agent-locations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_locations").select("*");
      if (error) throw error;
      return data as AgentLocation[];
    },
    refetchInterval: 30000,
  });

  
  const { data: rawSchedules = [], refetch: refetchSchedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ["dispatch-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_schedules")
        .select("*, leads(customer_name, service_type, status, priority, customer_address, latitude, longitude)")
        .order("scheduled_date");
      if (error) throw error;
      return data as Schedule[];
    },
  });

  /**
   * LOCKED RULE: a lead with an assigned person + a scheduled date IS a calendar job,
   * even if no job_schedules row exists yet. Synthesize a schedule-shaped tile for those.
   */
  const schedules = useMemo<Schedule[]>(() => {
    const withRow = new Set(rawSchedules.map(s => s.lead_id));
    const synthetic: Schedule[] = allLeads
      .filter(l => l.assigned_agent_id && l.scheduled_date && !withRow.has(l.id))
      .map(l => {
        const start = (l.scheduled_time || "08:00").slice(0, 8);
        const [h, m] = start.split(":").map(Number);
        const endH = Math.min((h || 8) + 2, 23);
        return {
          id: `lead-${l.id}`,
          lead_id: l.id,
          agent_id: l.assigned_agent_id as string,
          scheduled_date: l.scheduled_date as string,
          start_time: start,
          end_time: `${String(endH).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`,
          notes: null,
          leads: {
            customer_name: l.customer_name,
            service_type: l.service_type,
            status: l.status,
            priority: l.priority,
            customer_address: l.customer_address,
            latitude: l.latitude,
            longitude: l.longitude,
          },
        } as Schedule;
      });
    return [...rawSchedules, ...synthetic];
  }, [rawSchedules, allLeads]);


  // ─── Realtime subscriptions ───
  useEffect(() => {
    const leadsChannel = supabase
      .channel("dispatch-leads-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dispatch-leads"] });
      })
      .subscribe();

    const schedulesChannel = supabase
      .channel("dispatch-schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_schedules" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dispatch-schedules"] });
      })
      .subscribe();

    const locChannel = supabase
      .channel("dispatch-locations-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_locations" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dispatch-agent-locations"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(schedulesChannel);
      supabase.removeChannel(locChannel);
    };
  }, [queryClient]);

  // ─── Derived data ───
  const unassignedLeads = useMemo(() => {
    let leads: Lead[] = inboxMode
      ? (inboxLeads as unknown as Lead[])
      : allLeads.filter(l => !l.assigned_agent_id && l.status === "pending");
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      leads = leads.filter(l =>
        l.customer_name.toLowerCase().includes(q) ||
        l.customer_address.toLowerCase().includes(q) ||
        l.service_type.toLowerCase().includes(q)
      );
    }
    if (showUrgentOnly) {
      leads = leads.filter(l => l.priority === "urgent" || l.priority === "high");
    }
    return leads;
  }, [allLeads, inboxLeads, inboxMode, searchQuery, showUrgentOnly]);

  const dateRange = useMemo(() => {
    if (viewMode === "day") return [currentDate];
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [viewMode, currentDate]);

  const schedulesForDates = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    dateRange.forEach(d => {
      const key = format(d, "yyyy-MM-dd");
      map.set(key, schedules.filter(s => s.scheduled_date === key));
    });
    return map;
  }, [schedules, dateRange]);

  // Stats
  const stats = useMemo(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const inProgressToday = allLeads.filter(l => l.status === "in_progress").length;
    const onlineAgents = agentLocations.filter(a => {
      if (!a.last_updated) return false;
      const diff = Date.now() - new Date(a.last_updated).getTime();
      return diff < 10 * 60 * 1000; // 10 mins
    }).length;
    return {
      unassigned: unassignedLeads.length,
      inProgress: inProgressToday,
      onlineAgents,
      totalAgents: dispatchAgents.length,
    };
  }, [unassignedLeads, allLeads, agentLocations, dispatchAgents]);

  // ─── Mutations ───
  const assignMutation = useMutation({
    mutationFn: async ({ leadId, agentId, date, startTime, endTime }: { leadId: string; agentId: string; date: string; startTime: string; endTime: string }) => {
      // Check existing schedule for this lead
      const { data: existing } = await supabase
        .from("job_schedules")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("job_schedules")
          .update({ agent_id: agentId, scheduled_date: date, start_time: startTime, end_time: endTime })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("job_schedules")
          .insert({ lead_id: leadId, agent_id: agentId, scheduled_date: date, start_time: startTime, end_time: endTime });
        if (error) throw error;
      }

      // Update lead
      await supabase
        .from("leads")
        .update({
          assigned_agent_id: agentId,
          scheduled_date: date,
          scheduled_time: startTime,
          assignment_method: laneById.get(agentId) === "sales" ? "manual_sales" : "manual_dispatch",
        })
        .eq("id", leadId);
    },
    onSuccess: (_, variables) => {
      const agentName = dispatchAgents.find(a => a.id === variables.agentId)?.full_name || "technician";
      toast({ title: `✅ Job assigned to ${agentName}` });
      queryClient.invalidateQueries({ queryKey: ["dispatch-leads"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-schedules"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  // ─── Lane (sales vs service) ───
  const setLaneMutation = useMutation({
    mutationFn: async ({ leadId, lane }: { leadId: string; lane: LeadLane | null }) => {
      const { error } = await supabase
        .from("leads")
        .update(leadLaneFields(lane) as any)
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      toast({ title: v.lane ? `Lane set to ${LANE_META[v.lane].label}` : "Lane cleared — needs a human" });
      // Keep the open Quick Assign dialog in sync so the agent/date/time UI appears
      // immediately after the dispatcher picks a lane (no close/reopen needed).
      setQuickAssignLead(prev =>
        prev && prev.id === v.leadId ? ({ ...prev, ...leadLaneFields(v.lane) } as Lead) : prev
      );
      queryClient.invalidateQueries({ queryKey: ["dispatch-leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead-inbox"] });
    },
    onError: (err: any) => toast({ title: "Could not set lane", description: err.message, variant: "destructive" }),
  });

  // ─── Multi-select handler ───
  const handleCardClick = (e: React.MouseEvent, leadId: string) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setMultiSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(leadId)) next.delete(leadId);
        else next.add(leadId);
        return next;
      });
    }
  };

  // ─── Drag & Drop handlers ───
  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    // If multi-selected, drag all selected; otherwise drag just this one
    const dragIds = multiSelectedIds.size > 0 && multiSelectedIds.has(lead.id)
      ? Array.from(multiSelectedIds)
      : [lead.id];
    setDraggingLead(lead);
    setIsDragging(true);
    e.dataTransfer.setData("text/plain", dragIds.join(","));
    e.dataTransfer.effectAllowed = "move";

    // Custom ghost image
    const ghost = document.createElement("div");
    ghost.className = "fixed pointer-events-none bg-blue-900/70 border-2 border-blue-400 rounded-lg shadow-2xl text-white text-xs px-3 py-2 z-50";
    ghost.textContent = dragIds.length > 1 ? `${dragIds.length} jobs` : lead.customer_name;
    ghost.style.cssText = "position:absolute;top:-1000px;left:-1000px;opacity:0.85;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 20);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  };

  const handleScheduleDragStart = (e: React.DragEvent, schedule: Schedule) => {
    const lead = allLeads.find(l => l.id === schedule.lead_id);
    if (lead) {
      setDraggingLead(lead);
      setIsDragging(true);
      e.dataTransfer.setData("text/plain", schedule.lead_id);
      e.dataTransfer.setData("application/schedule-id", schedule.id);
      e.dataTransfer.effectAllowed = "move";
    }
  };

  const handleDrop = (e: React.DragEvent, agentId: string, dateStr: string, hour: number) => {
    e.preventDefault();
    setDragOverSlot(null);
    setIsDragging(false);
    const rawIds = e.dataTransfer.getData("text/plain");
    if (!rawIds) return;

    const leadIds = rawIds.split(",").filter(Boolean);
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const endTime = `${String(Math.min(hour + 2, 20)).padStart(2, "0")}:00`;

    // Check for overlapping bookings
    const slotKey = `${agentId}-${dateStr}-${hour}`;
    const conflict = hasConflict(agentId, dateStr, hour);
    if (conflict) {
      setShakeSlot(slotKey);
      setTimeout(() => setShakeSlot(null), 600);
      toast({ title: "⚠️ Time conflict", description: "This slot already has a booking. Choose a different time.", variant: "destructive" });
      return;
    }

    // Assign all dragged leads
    const agentName = dispatchAgents.find(a => a.id === agentId)?.full_name || "technician";
    if (leadIds.length > 1) {
      // Bulk assign - show consolidated toast after all mutations
      let completed = 0;
      leadIds.forEach(leadId => {
        assignMutation.mutate(
          { leadId, agentId, date: dateStr, startTime, endTime },
          {
            onSuccess: () => {
              completed++;
              if (completed === leadIds.length) {
                toast({ title: `✅ ${leadIds.length} jobs assigned to ${agentName} — ${startTime}–${endTime}` });
              }
            },
          }
        );
      });
    } else {
      leadIds.forEach(leadId => {
        assignMutation.mutate({ leadId, agentId, date: dateStr, startTime, endTime });
      });
    }

    setMultiSelectedIds(new Set());
    setDraggingLead(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleSlotDragEnter = (slotKey: string) => {
    setDragOverSlot(slotKey);
  };

  const handleSlotDragLeave = () => {
    setDragOverSlot(null);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverSlot(null);
    setDraggingLead(null);
  };

  // ─── Map ───
  useEffect(() => {
    if (!showMapPane || !mapContainerRef.current) return;
    let cancelled = false;
    (async () => {
      const token = getMapboxTokenSync() || (await getMapboxToken());
      if (cancelled || !token || !mapContainerRef.current) return;

      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [18.4241, -33.9249], // Cape Town
        zoom: 11,
      });
      mapRef.current = map;
      map.on("load", () => updateMapMarkers());
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [showMapPane]);

  useEffect(() => {
    if (mapRef.current && showMapPane) updateMapMarkers();
  }, [selectedJobIds, agentLocations, showMapPane, allLeads]);

  const updateMapMarkers = () => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const jobsToShow = selectedJobIds.size > 0
      ? allLeads.filter(l => selectedJobIds.has(l.id))
      : allLeads.filter(l => l.status !== "completed").slice(0, 20);

    jobsToShow.forEach(lead => {
      const el = document.createElement("div");
      el.style.cssText = `width:12px;height:12px;border-radius:50%;background:${STATUS_COLORS[lead.status] || "#6b7280"};border:2px solid white;cursor:pointer;`;
      const marker = new mapboxgl.Marker(el)
        .setLngLat([lead.longitude, lead.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML(
          `<div style="font-size:12px;"><strong>${lead.customer_name}</strong><br/>${lead.service_type}<br/><span style="color:#888">${getSuburb(lead.customer_address)}</span></div>`
        ))
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });

    // Agent locations
    agentLocations.forEach(loc => {
      const agent = dispatchAgents.find(a => a.id === loc.agent_id);
      const el = document.createElement("div");
      el.style.cssText = `width:16px;height:16px;border-radius:50%;background:hsl(204,100%,36%);border:2px solid white;cursor:pointer;`;
      el.title = agent?.full_name || "Agent";
      const marker = new mapboxgl.Marker(el)
        .setLngLat([loc.longitude, loc.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML(
          `<div style="font-size:12px;"><strong>📍 ${agent?.full_name || "Agent"}</strong><br/><span style="color:#888">Last seen: ${loc.last_updated ? format(new Date(loc.last_updated), "HH:mm") : "N/A"}</span></div>`
        ))
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });
  };

  // ─── Navigation ───
  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => setCurrentDate(d => addDays(d, viewMode === "day" ? -1 : -7));
  const goNext = () => setCurrentDate(d => addDays(d, viewMode === "day" ? 1 : 7));

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          setMultiSelectedIds(new Set());
        }
        return;
      }
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setSidebarCollapsed(false);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setViewMode(prev => prev === "day" ? "week" : "day");
      } else if (e.key === "Escape") {
        setMultiSelectedIds(new Set());
        setDraggingLead(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ─── Agent online status helper ───
  const isAgentOnline = (agentId: string) => {
    if (isPresenceOnline(agentId)) return true;
    const loc = agentLocations.find(a => a.agent_id === agentId);
    if (!loc?.last_updated) return false;
    return Date.now() - new Date(loc.last_updated).getTime() < 10 * 60 * 1000;
  };

  // ─── Conflict check ───
  const hasConflict = (agentId: string, dateStr: string, hour: number) => {
    const daySchedules = schedulesForDates.get(dateStr) || [];
    const agentScheds = daySchedules.filter(s => s.agent_id === agentId);
    const slotStart = hour * 60;
    const slotEnd = (hour + 1) * 60;
    return agentScheds.some(s => {
      const sStart = timeToMinutes(s.start_time);
      const sEnd = timeToMinutes(s.end_time);
      return slotStart < sEnd && slotEnd > sStart;
    });
  };

  const isInitialLoading = leadsLoading && schedulesLoading;

  if (isInitialLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
        <KpiGridSkeleton count={4} />
        <div className="grid gap-4 md:grid-cols-2">
          <JobCardListSkeleton rows={3} />
          <JobCardListSkeleton rows={3} />
        </div>
      </div>
    );
  }

  if (leadsError) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
          <p className="font-medium">Failed to load jobs</p>
          <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── Header Stats Bar ─── */}
      <div className="shrink-0 border-b bg-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4 mr-auto">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Dispatch Board</h2>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <StatBadge icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Unassigned" value={stats.unassigned} variant="warning" />
            <StatBadge icon={<Zap className="h-3.5 w-3.5" />} label="In Progress" value={stats.inProgress} variant="success" />
            <StatBadge icon={<Users className="h-3.5 w-3.5" />} label="Online" value={`${stats.onlineAgents}/${stats.totalAgents}`} variant="primary" />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={goNext}><ChevronRight className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {viewMode === "day"
              ? format(currentDate, "EEE, d MMM yyyy")
              : `${format(dateRange[0], "d MMM")} – ${format(dateRange[dateRange.length - 1], "d MMM yyyy")}`}
          </span>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "day" | "week")}>
            <TabsList className="h-8">
              <TabsTrigger value="day" className="text-xs px-3 h-7">Day</TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-3 h-7">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant={showMapPane ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMapPane(!showMapPane)}
          >
            <MapPin className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ─── Main content: sidebar + timeline (+ optional map) ─── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Unassigned Jobs Sidebar */}
        <div className={`shrink-0 border-r bg-card flex flex-col transition-all duration-200 ${sidebarCollapsed ? "w-10" : "w-80"}`}>
          {sidebarCollapsed ? (
            <button onClick={() => setSidebarCollapsed(false)} className="h-full flex items-center justify-center hover:bg-muted transition-colors" title="Expand sidebar">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <>
              <div className="p-3 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">{inboxMode ? "New Leads Inbox" : "Unassigned Jobs"}</h3>
                  <div className="flex items-center gap-1">
                    <Badge variant={inboxMode ? "destructive" : "secondary"} className="text-xs">{unassignedLeads.length}</Badge>
                    <button onClick={() => setSidebarCollapsed(true)} className="p-1 hover:bg-muted rounded" title="Collapse"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Search jobs... (A)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant={showUrgentOnly ? "default" : "outline"}
                    size="sm"
                    className="flex-1 text-xs h-7"
                    onClick={() => setShowUrgentOnly(!showUrgentOnly)}
                  >
                    <Filter className="h-3 w-3 mr-1" />
                    {showUrgentOnly ? "Urgent/High" : "Urgent"}
                  </Button>
                  <Button
                    variant={inboxMode ? "default" : "outline"}
                    size="sm"
                    className="flex-1 text-xs h-7"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      if (inboxMode) next.delete("inbox");
                      else next.set("inbox", "1");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    {inboxMode ? "Show all" : "Inbox only"}
                  </Button>
                </div>
                <Button
                  variant="brand"
                  size="sm"
                  className="w-full text-xs h-7"
                  onClick={() => setShowCreateLead(true)}
                >
                  New Lead
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1.5">
                  {unassignedLeads.length === 0 && (
                    <div className="px-3 py-8 text-center space-y-1">
                      <p className="text-xs font-medium">
                        {inboxMode ? "Inbox clear" : "No unassigned jobs"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {inboxMode
                          ? "Every lead has a salesperson or technician and a date."
                          : "Nothing waiting to be dispatched."}
                      </p>
                    </div>
                  )}
                  {unassignedLeads.map(lead => (
                    <motion.div
                      key={lead.id}
                      layout
                      whileDrag={{ scale: 1.05, rotate: 2, zIndex: 50 }}
                      whileHover={{ scale: 1.02 }}
                      draggable
                      onDragStart={(e) => handleDragStart(e as any, lead)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => handleCardClick(e as any, lead.id)}
                      className={`bg-gradient-to-br from-primary/[0.06] to-muted/40 dark:from-[#0f2240]/70 dark:via-[#1a3a5c]/30 dark:to-[#0d1a30]/50 border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors group ${
                        multiSelectedIds.has(lead.id)
                          ? "ring-2 ring-primary border-primary/60 bg-primary/10"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <GripVertical className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setJobInfoLead(lead); setJobInfoSchedule(null); }}
                        >
                          <p className="font-medium text-xs break-words">{lead.customer_name}</p>
                          <p className="text-[11px] text-muted-foreground break-words">{getSuburb(lead.customer_address)}</p>
                        </div>
                        <Badge variant={PRIORITY_COLORS[lead.priority] as any || "secondary"} className="text-[10px] h-5 shrink-0">
                          {lead.priority}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {(() => {
                          const lane = laneOf(lead);
                          return (
                            <Badge
                              variant="outline"
                              className={`text-[10px] h-5 ${lane ? LANE_META[lane].className : UNKNOWN_LANE_META.className}`}
                            >
                              {lane ? LANE_META[lane].label : UNKNOWN_LANE_META.label}
                            </Badge>
                          );
                        })()}
                        <Badge variant="outline" className="text-[10px] h-auto whitespace-normal break-words">
                          {lead.service_type}
                        </Badge>
                      </div>
                      {/* Dispatcher can set / change the lane while the lead is uncommitted */}
                      <div className="flex items-center gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                        {(["sales", "service"] as LeadLane[]).map(l => (
                          <Button
                            key={l}
                            type="button"
                            size="sm"
                            variant={laneOf(lead) === l ? "default" : "outline"}
                            className="h-6 px-2 text-[10px]"
                            disabled={setLaneMutation.isPending}
                            onClick={() => setLaneMutation.mutate({ leadId: lead.id, lane: l })}
                          >
                            {LANE_META[l].label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">

                        {lead.scheduled_time && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />{lead.scheduled_time}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuickAssignLead(lead);
                            setQuickAssignAgent("");
                            setQuickAssignDate(format(currentDate, "yyyy-MM-dd"));
                            setQuickAssignStart("08:00");
                            setQuickAssignEnd("10:00");
                          }}
                          title="Quick Assign"
                        >
                          <User className="h-3 w-3" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        {/* Timeline + Map area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Map Pane */}
          {showMapPane && (
            <div className="h-48 border-b shrink-0 relative">
              <div ref={mapContainerRef} className="w-full h-full" />
            </div>
          )}

          {/* Resource Timeline */}
          <div className="flex-1 overflow-auto">
            {viewMode === "day" ? (
              <DayTimeline
                date={currentDate}
                agents={dispatchAgents}
                laneById={laneById}
                schedules={schedulesForDates.get(format(currentDate, "yyyy-MM-dd")) || []}
                isAgentOnline={isAgentOnline}
                hasConflict={hasConflict}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onScheduleDragStart={handleScheduleDragStart}
                pxPerHour={PX_PER_HOUR}
                allLeads={allLeads}
                onJobInfoClick={(lead, schedule) => { setJobInfoLead(lead); setJobInfoSchedule(schedule); }}
                isDragging={isDragging}
                dragOverSlot={dragOverSlot}
                onSlotDragEnter={handleSlotDragEnter}
                onSlotDragLeave={handleSlotDragLeave}
                shakeSlot={shakeSlot}
              />
            ) : (
              <WeekTimeline
                dates={dateRange}
                agents={dispatchAgents}
                laneById={laneById}
                schedulesMap={schedulesForDates}
                isAgentOnline={isAgentOnline}
                hasConflict={hasConflict}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onScheduleDragStart={handleScheduleDragStart}
                pxPerHour={PX_PER_HOUR}
                allLeads={allLeads}
                onJobInfoClick={(lead, schedule) => { setJobInfoLead(lead); setJobInfoSchedule(schedule); }}
                isDragging={isDragging}
                dragOverSlot={dragOverSlot}
                onSlotDragEnter={handleSlotDragEnter}
                onSlotDragLeave={handleSlotDragLeave}
              />
            )}
          </div>
        </div>
      </div>

      {/* ─── Quick Assign Dialog ─── */}
      <Dialog open={!!quickAssignLead} onOpenChange={(open) => { if (!open) setQuickAssignLead(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Lead</DialogTitle>
            <DialogDescription>
              Assign <span className="font-semibold">{quickAssignLead?.customer_name}</span> – {quickAssignLead?.service_type}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const lane = quickAssignLead ? laneOf(quickAssignLead) : null;
            if (!lane) {
              return (
                <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm">
                  <p className="font-medium">This lead needs a human to pick a lane.</p>
                  <p className="text-xs text-muted-foreground">
                    Sales leads go to a named salesperson. Service leads are offered to nearby technicians.
                    Nothing is broadcast until you choose.
                  </p>
                  <div className="flex gap-2">
                    {(["sales", "service"] as LeadLane[]).map(l => (
                      <Button
                        key={l}
                        size="sm"
                        variant="outline"
                        disabled={setLaneMutation.isPending}
                        onClick={() => quickAssignLead && setLaneMutation.mutate({ leadId: quickAssignLead.id, lane: l })}
                      >
                        {LANE_META[l].label}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            }
            const candidates =
              lane === "sales"
                ? salesStaff.map(s => ({ id: s.id, full_name: s.full_name }))
                : technicians.length
                  ? technicians.map(s => ({ id: s.id, full_name: s.full_name }))
                  : dispatchAgents.map(a => ({ id: a.id, full_name: a.full_name }));
            return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">{lane === "sales" ? "Salesperson" : "Technician"}</Label>
              <Select value={quickAssignAgent} onValueChange={setQuickAssignAgent}>
                <SelectTrigger>
                  <SelectValue placeholder={candidates.length ? `Select ${lane === "sales" ? "salesperson" : "technician"}` : `No ${lane === "sales" ? "sales" : "technician"} lane people yet`} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${isAgentOnline(a.id) ? "bg-success" : "bg-muted-foreground/40"}`} />
                        {a.full_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {lane === "sales"
                  ? "Named assignment — sales leads are never a first-accept race."
                  : "Technician lane only. First-accept broadcast still applies to nearby techs."}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Date</Label>
              <Input type="date" value={quickAssignDate} onChange={e => setQuickAssignDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm">Start Time</Label>
                <Input type="time" value={quickAssignStart} onChange={e => setQuickAssignStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">End Time</Label>
                <Input type="time" value={quickAssignEnd} onChange={e => setQuickAssignEnd(e.target.value)} />
              </div>
            </div>
          </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAssignLead(null)}>Cancel</Button>
            <Button
              disabled={!quickAssignAgent || !laneOf(quickAssignLead || {}) || assignMutation.isPending}

              onClick={() => {
                if (!quickAssignLead || !quickAssignAgent) return;
                assignMutation.mutate(
                  { leadId: quickAssignLead.id, agentId: quickAssignAgent, date: quickAssignDate, startTime: quickAssignStart, endTime: quickAssignEnd },
                  { onSuccess: () => setQuickAssignLead(null) }
                );
              }}
            >
              {assignMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Assign Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Job Info Dialog ─── */}
      <Dialog open={!!jobInfoLead} onOpenChange={(open) => { if (!open) { setJobInfoLead(null); setJobInfoSchedule(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              Job Details
            </DialogTitle>
            <DialogDescription>
              Every field is editable — changes save instantly and sync to the board, calendar and customer.
            </DialogDescription>
          </DialogHeader>
          {jobInfoLead && (
            <div className="space-y-3">
              <EntityDetailsForm
                entityType="lead"
                entityId={jobInfoLead.id}
                initialData={jobInfoLead as any}
                visibleFields={[
                  "customer_name",
                  "customer_phone",
                  "customer_address",
                  "service_type",
                  "priority",
                  "status",
                  "assigned_agent_id",
                  "scheduled_date",
                  "scheduled_time",
                  "order_status",
                  "parts_status",
                  "notes",
                ]}
              />
              {jobInfoSchedule && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Calendar slot: {jobInfoSchedule.scheduled_date} · {jobInfoSchedule.start_time} – {jobInfoSchedule.end_time}
                  </p>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            {jobInfoLead && !jobInfoLead.assigned_agent_id && (
              <Button
                onClick={() => {
                  const lead = jobInfoLead;
                  setJobInfoLead(null);
                  setJobInfoSchedule(null);
                  setQuickAssignLead(lead);
                  setQuickAssignAgent("");
                  setQuickAssignDate(format(currentDate, "yyyy-MM-dd"));
                  setQuickAssignStart("08:00");
                  setQuickAssignEnd("10:00");
                }}
              >
                <User className="h-4 w-4 mr-1" />
                Assign Job
              </Button>
            )}
            <Button variant="outline" onClick={() => { setJobInfoLead(null); setJobInfoSchedule(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />
    </div>
  );
};

// ─── Stat Badge ───
const StatBadge = ({ icon, label, value, variant }: { icon: React.ReactNode; label: string; value: number | string; variant: "warning" | "success" | "primary" }) => {
  const colors = {
    warning: "bg-warning/10 text-warning border-warning/20",
    success: "bg-success/10 text-success border-success/20",
    primary: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colors[variant]}`}>
      {icon}
      <span className="font-bold">{value}</span>
      <span className="hidden lg:inline opacity-70">{label}</span>
    </div>
  );
};

// ─── Day Timeline ───
// ─── Lane grouping: Sales first, then Technical, then unlaned ───
const LANE_GROUPS: { key: LeadLane | null; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "service", label: "Technical" },
  { key: null, label: "Needs lane" },
];

/** Sort rank: sales (0), service (1), unknown (2). */
const laneRank = (lane: LeadLane | null | undefined) =>
  lane === "sales" ? 0 : lane === "service" ? 1 : 2;

function groupAgentsByLane(agents: Agent[], laneById: Map<string, LeadLane | null>) {
  return LANE_GROUPS
    .map(g => ({ ...g, agents: agents.filter(a => (laneById.get(a.id) ?? null) === g.key) }))
    .filter(g => g.agents.length > 0);
}

/** Small lane badge for staff rows. Staff badge says "Tech" (not "Service"); lead labels unchanged. */
function LaneBadge({ lane }: { lane: LeadLane | null }) {
  return (
    <span
      className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold leading-tight whitespace-nowrap ${
        lane ? LANE_META[lane].className : UNKNOWN_LANE_META.className
      }`}
    >
      {lane === "sales" ? "Sales" : lane === "service" ? "Tech" : "Needs lane"}
    </span>
  );
}

// ─── Day Timeline ───
const DayTimeline = ({
  date, agents, schedules, isAgentOnline, hasConflict, onDrop, onDragOver, onScheduleDragStart, pxPerHour, allLeads, onJobInfoClick, laneById,
  isDragging, dragOverSlot, onSlotDragEnter, onSlotDragLeave, shakeSlot,
}: {
  date: Date;
  agents: Agent[];
  laneById: Map<string, LeadLane | null>;
  schedules: Schedule[];
  isAgentOnline: (id: string) => boolean;
  hasConflict: (agentId: string, dateStr: string, hour: number) => boolean;
  onDrop: (e: React.DragEvent, agentId: string, dateStr: string, hour: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onScheduleDragStart: (e: React.DragEvent, schedule: Schedule) => void;
  pxPerHour: number;
  allLeads: Lead[];
  onJobInfoClick: (lead: Lead, schedule: Schedule) => void;
  isDragging: boolean;
  dragOverSlot: string | null;
  onSlotDragEnter: (slotKey: string) => void;
  onSlotDragLeave: () => void;
  shakeSlot: string | null;
}) => {
  const dateStr = format(date, "yyyy-MM-dd");
  const now = new Date();
  const currentMinuteOffset = isToday(date) ? (now.getHours() - 6) * pxPerHour + (now.getMinutes() / 60) * pxPerHour : -1;

  return (
    <div className="flex min-w-0">
      {/* Time gutter */}
      <div className="shrink-0 w-14 border-r bg-muted/30">
        <div className="h-10 border-b" /> {/* header spacer */}
        {HOURS.map(h => (
          <div key={h} className="border-b flex items-start justify-end pr-2 pt-1 text-[10px] text-muted-foreground" style={{ height: pxPerHour }}>
            {`${String(h).padStart(2, "0")}:00`}
          </div>
        ))}
      </div>

      {/* Agent columns */}
      <div className="flex flex-1 min-w-0 overflow-x-auto">
        {/* Unassigned lane — scheduled jobs with no technician yet */}
        {(() => {
          const unassignedToday = allLeads.filter(
            l => !l.assigned_agent_id && l.scheduled_date === dateStr && !!l.scheduled_time
          );
          return (
            <div className="flex-1 min-w-[160px] border-r bg-warning/5">
              <div className="h-10 border-b px-2 flex items-center gap-1.5 bg-warning/10 sticky top-0 z-10">
                <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                <span className="text-xs font-medium truncate">Unassigned</span>
                {unassignedToday.length > 0 && (
                  <Badge variant="secondary" className="ml-auto h-4 text-[9px] px-1">{unassignedToday.length}</Badge>
                )}
              </div>
              <div className="relative">
                {HOURS.map(h => (
                  <div key={h} className="border-b" style={{ height: pxPerHour }} />
                ))}
                {unassignedToday.map(lead => {
                  const startMins = timeToMinutes(lead.scheduled_time as string) - 6 * 60;
                  const top = minutesToPx(startMins, pxPerHour);
                  const height = minutesToPx(120, pxPerHour);
                  return (
                    <div
                      key={lead.id}
                      className="absolute left-1 right-1 rounded-md border border-dashed border-warning bg-warning/15 px-1.5 py-1 text-[10px] cursor-pointer overflow-y-auto"
                      style={{ top, height }}
                      title={`${lead.customer_name} • ${lead.scheduled_time} • Unassigned`}
                      onClick={() => onJobInfoClick(lead, null as any)}
                    >
                      <p className="font-semibold leading-tight break-words">{lead.customer_name}</p>
                      <p className="break-words opacity-80">{lead.service_type}</p>
                      <span className="mt-0.5 inline-block rounded bg-warning/30 px-1 text-[9px] font-medium">Unassigned</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {agents.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-20">
            No staff found. Add sales people or technicians in Settings.
          </div>
        )}

        {groupAgentsByLane(agents, laneById).map(group => (
          <Fragment key={group.key ?? "unknown"}>
            {/* Lane group header strip */}
            <div className="shrink-0 w-5 border-r bg-muted/20">
              <div className="h-10 border-b flex items-center justify-center overflow-hidden">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
                  {group.label}
                </span>
              </div>
              {HOURS.map(h => (
                <div key={h} className="border-b" style={{ height: pxPerHour }} />
              ))}
            </div>
            {group.agents.map(agent => {
          const agentSchedules = schedules.filter(s => s.agent_id === agent.id);
          const online = isAgentOnline(agent.id);
          const lane = laneById.get(agent.id) ?? null;

          return (
            <div key={agent.id} className="flex-1 min-w-[160px] border-r last:border-r-0">
              {/* Agent header */}
              <div className="h-10 border-b px-2 flex items-center gap-1.5 bg-muted/30 sticky top-0 z-10">
                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${online ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
                <span className="text-xs font-medium truncate">{agent.full_name}</span>
                <LaneBadge lane={lane} />
                {online && <span className="text-[9px] text-success font-semibold ml-auto shrink-0">Online</span>}
              </div>

              {/* Time slots */}
              <div className="relative">
                {HOURS.map(h => {
                  const slotKey = `${agent.id}-${dateStr}-${h}`;
                  const conflict = hasConflict(agent.id, dateStr, h);
                  const isDropTarget = dragOverSlot === slotKey;
                  const isShaking = shakeSlot === slotKey;
                  return (
                    <div
                      key={h}
                      className={`border-b transition-all duration-150 ${
                        isShaking
                          ? "bg-destructive/20 animate-[shake_0.5s_ease-in-out]"
                          : isDropTarget && isDragging
                            ? "bg-blue-600/30 border-2 border-dashed border-blue-400"
                            : conflict
                              ? "bg-destructive/5"
                              : isDragging
                                ? "hover:bg-primary/10"
                                : "hover:bg-primary/5"
                      }`}
                      style={{ height: pxPerHour }}
                      onDragOver={onDragOver}
                      onDragEnter={() => onSlotDragEnter(slotKey)}
                      onDragLeave={onSlotDragLeave}
                      onDrop={(e) => onDrop(e, agent.id, dateStr, h)}
                    />
                  );
                })}

                {/* Scheduled events */}
                {agentSchedules.map(schedule => {
                  const startMins = timeToMinutes(schedule.start_time) - 6 * 60;
                  const endMins = timeToMinutes(schedule.end_time) - 6 * 60;
                  const top = minutesToPx(startMins, pxPerHour);
                  const height = Math.max(minutesToPx(endMins - startMins, pxPerHour), 24);
                  const status = schedule.leads?.status || "pending";

                  return (
                    <motion.div
                      key={schedule.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      draggable
                      onDragStart={(e) => onScheduleDragStart(e as any, schedule)}
                      className="absolute left-1 right-1 rounded-md px-1.5 py-1 text-[10px] cursor-pointer overflow-y-auto border shadow-sm"
                      style={{
                        top,
                        height,
                        background: `linear-gradient(135deg, ${STATUS_COLORS[status] || "#6b7280"}, ${STATUS_COLORS[status] || "#6b7280"}cc)`,
                        borderColor: STATUS_COLORS[status] || "#6b7280",
                        color: "white",
                      }}
                      title={`${schedule.leads?.customer_name} • ${schedule.start_time}–${schedule.end_time}`}
                      onClick={() => {
                        const lead = allLeads.find(l => l.id === schedule.lead_id);
                        if (lead) { onJobInfoClick(lead, schedule); }
                      }}
                    >
                      <p className="font-semibold leading-tight break-words">{schedule.leads?.customer_name || "Job"}</p>
                      {height > 30 && <p className="break-words opacity-80">{schedule.leads?.service_type}</p>}
                      {height > 45 && <p className="opacity-60">{schedule.start_time}–{schedule.end_time}</p>}
                    </motion.div>
                  );
                })}

                {/* Current time indicator */}
                {currentMinuteOffset > 0 && currentMinuteOffset < HOURS.length * pxPerHour && (
                  <div
                    className="absolute left-0 right-0 border-t-2 border-destructive z-20 pointer-events-none"
                    style={{ top: currentMinuteOffset }}
                  >
                    <div className="h-2 w-2 rounded-full bg-destructive -translate-y-1" />
                  </div>
                )}
              </div>
            </div>
          );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
};

// ─── Week Timeline (compact) ───
const WeekTimeline = ({
  dates, agents, schedulesMap, isAgentOnline, hasConflict, onDrop, onDragOver, onScheduleDragStart, pxPerHour, allLeads, onJobInfoClick, laneById,
  isDragging, dragOverSlot, onSlotDragEnter, onSlotDragLeave,
}: {
  dates: Date[];
  agents: Agent[];
  laneById: Map<string, LeadLane | null>;
  schedulesMap: Map<string, Schedule[]>;
  isAgentOnline: (id: string) => boolean;
  hasConflict: (agentId: string, dateStr: string, hour: number) => boolean;
  onDrop: (e: React.DragEvent, agentId: string, dateStr: string, hour: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onScheduleDragStart: (e: React.DragEvent, schedule: Schedule) => void;
  pxPerHour: number;
  allLeads: Lead[];
  onJobInfoClick: (lead: Lead, schedule: Schedule) => void;
  isDragging: boolean;
  dragOverSlot: string | null;
  onSlotDragEnter: (slotKey: string) => void;
  onSlotDragLeave: () => void;
}) => {
  const COMPACT_HEIGHT = 52;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[800px]">
        <thead>
          <tr>
            <th className="border-b border-r p-2 text-xs font-semibold text-muted-foreground bg-muted/30 sticky left-0 z-10 w-36">
              Staff
            </th>
            {dates.map(d => (
              <th key={d.toISOString()} className={`border-b p-2 text-xs font-semibold ${isToday(d) ? "bg-primary/10 text-primary" : "text-muted-foreground bg-muted/30"}`}>
                {format(d, "EEE d")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border-b border-r p-2 bg-warning/10 sticky left-0 z-10">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                <span className="text-xs font-medium truncate">Unassigned</span>
              </div>
            </td>
            {dates.map(d => {
              const dateStr = format(d, "yyyy-MM-dd");
              const dayLeads = allLeads.filter(l => !l.assigned_agent_id && l.scheduled_date === dateStr);
              return (
                <td key={dateStr} className={`border-b p-1 align-top min-w-[100px] ${isToday(d) ? "bg-warning/10" : "bg-warning/5"}`}>
                  <div className="space-y-0.5">
                    {dayLeads.map(lead => (
                      <div
                        key={lead.id}
                        className="rounded border border-dashed border-warning bg-warning/20 px-1.5 py-0.5 text-[10px] cursor-pointer break-words"
                        title={`${lead.customer_name} • Unassigned`}
                        onClick={() => onJobInfoClick(lead, null as any)}
                      >
                        <span className="font-medium">{(lead.scheduled_time || "").slice(0, 5)}</span> {lead.customer_name}
                      </div>
                    ))}
                    {dayLeads.length === 0 && (
                      <div className="text-[10px] text-muted-foreground/40 text-center py-2">—</div>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
          {groupAgentsByLane(agents, laneById).map(group => (
            <Fragment key={group.key ?? "unknown"}>
              {/* Lane group header row */}
              <tr>
                <td colSpan={dates.length + 1} className="border-b border-r bg-muted/20 px-2 py-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </span>
                </td>
              </tr>
              {group.agents.map(agent => (

            <tr key={agent.id}>
              <td className="border-b border-r p-2 bg-card sticky left-0 z-10">
                <div className="flex items-center gap-1.5">
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${isAgentOnline(agent.id) ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
                  <span className="text-xs font-medium truncate">{agent.full_name}</span>
                  <LaneBadge lane={laneById.get(agent.id) ?? null} />
                  {isAgentOnline(agent.id) && <span className="text-[9px] text-success font-semibold ml-auto shrink-0">Online</span>}
                </div>
              </td>
              {dates.map(d => {
                const dateStr = format(d, "yyyy-MM-dd");
                const daySchedules = (schedulesMap.get(dateStr) || []).filter(s => s.agent_id === agent.id);

                return (
                  <td
                    key={dateStr}
                    className={`border-b p-1 align-top min-w-[100px] transition-all duration-150 ${
                      dragOverSlot === `${agent.id}-${dateStr}-8` && isDragging
                        ? "bg-blue-600/30 border-2 border-dashed border-blue-400"
                        : isToday(d) ? "bg-primary/5" : ""
                    }`}
                    style={{ minHeight: COMPACT_HEIGHT }}
                    onDragOver={onDragOver}
                    onDragEnter={() => onSlotDragEnter(`${agent.id}-${dateStr}-8`)}
                    onDragLeave={onSlotDragLeave}
                    onDrop={(e) => onDrop(e, agent.id, dateStr, 8)}
                  >
                    <div className="space-y-0.5">
                      {daySchedules.map(schedule => {
                        const status = schedule.leads?.status || "pending";
                        return (
                          <div
                            key={schedule.id}
                            draggable
                            onDragStart={(e) => onScheduleDragStart(e, schedule)}
                            className="rounded px-1.5 py-0.5 text-[10px] text-white cursor-pointer break-words"
                            style={{ backgroundColor: STATUS_COLORS[status] || "#6b7280" }}
                            title={`${schedule.leads?.customer_name} ${schedule.start_time}–${schedule.end_time}`}
                            onClick={() => {
                              const lead = allLeads.find(l => l.id === schedule.lead_id);
                              if (lead) onJobInfoClick(lead, schedule);
                            }}
                          >
                            <span className="font-medium">{schedule.start_time}</span> {schedule.leads?.customer_name || "Job"}
                          </div>
                        );
                      })}
                      {daySchedules.length === 0 && (
                        <div className="text-[10px] text-muted-foreground/40 text-center py-2">—</div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminDispatchPage;
