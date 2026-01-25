import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, LogOut, MapPin, Navigation, ChevronUp, ChevronDown, List, Clock, Loader2, Map, Timer, AlertCircle, RefreshCw, Home } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import logo from "@/assets/logo.png";
import LeadDetailSheet from "@/components/LeadDetailSheet";
import LeadCardProgress from "@/components/LeadCardProgress";
import AvailabilityIndicator from "@/components/AvailabilityIndicator";
import { formatElapsedTime } from "@/hooks/useJobTimer";
import { useAvailability } from "@/hooks/useAvailability";
import { calculateDistanceKm, formatDistance } from "@/lib/geolocation";
import { useOffline } from "@/contexts/OfflineContext";
import { useOfflineLeads } from "@/hooks/useOfflineLeads";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { notifyJobAssigned, notifyTechEnRoute } from "@/lib/notificationService";
import PullToRefresh from "@/components/PullToRefresh";
import Layout from "@/components/Layout";
import { createTeardropMarkerElement } from "@/utils/MarkerUtils";
import StatusFilterButtons, { LeadStatusFilter } from "@/components/StatusFilterButtons";
import LeadListFilterPills, { LeadListStatus } from "@/components/LeadListFilterPills";
import FieldAgentLeadCard from "@/components/FieldAgentLeadCard";

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  // New duration tracking fields
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
}

// Priority order for sorting
const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// Format relative time for popup display
const formatTimeAgo = (createdAt: string): string => {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

// Status colors for popup badges (matching Admin Dashboard)
const statusColors: Record<string, string> = {
  pending: "#ef4444",
  open: "#ef4444",
  released: "#f97316",
  claimed: "#eab308",
  accepted: "#eab308",
  in_progress: "#22c55e",
  completed: "#000000",
};

// Priority colors
const getPriorityColor = (priority: string | undefined): string | null => {
  if (priority === "urgent") return "#ef4444";
  if (priority === "high") return "#f97316";
  return null;
};

const FieldAgent = () => {
  const MAP_CHROME_BOTTOM_OFFSET_PX = 64;
  const [loading, setLoading] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [, setMapboxToken] = useState<string>("");
  const [showTokenInput, setShowTokenInput] = useState(true);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"available" | "active">("available");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [userName, setUserName] = useState<string>("");
  const [showMapOnMobile, setShowMapOnMobile] = useState(false);
  const [isAvailableForLeads, setIsAvailableForLeads] = useState(true);
  const [locationUpdating, setLocationUpdating] = useState(false);
  const [homeBaseLat, setHomeBaseLat] = useState<number | null>(null);
  const [homeBaseLng, setHomeBaseLng] = useState<number | null>(null);
  const [, setTimerTick] = useState(0); // Force re-renders for timer updates
  const [statusFilters, setStatusFilters] = useState<Set<LeadStatusFilter>>(
    new Set(["pending", "accepted", "in_progress"])
  );
  // Map-list sync state
  const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null);
  const [visibleLeadIds, setVisibleLeadIds] = useState<Set<string>>(new Set());
  const [availableListFilter, setAvailableListFilter] = useState<LeadListStatus>("all");
  const [activeListFilter, setActiveListFilter] = useState<LeadListStatus>("all");
  const highlightTimeoutRef = useRef<number | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Offline support
  const { isOnline, syncStatus, queueOperation, retrySyncFailedOperations, clearFailedOperations, deleteOperation, getPendingOperationsList } = useOffline();
  const offlineLeads = useOfflineLeads(currentUserId, isOnline, queueOperation);

  // Availability tracking
  const availability = useAvailability(currentUserId);

  // Use offline leads data
  const leads = offlineLeads.leads as Lead[];

  useEffect(() => {
    checkAuth();
    startLocationTracking();

    // Check for Mapbox token from localStorage
    const storedToken = localStorage.getItem('mapbox_token');

    if (storedToken && storedToken.startsWith('pk.')) {
      setMapboxToken(storedToken);
      setShowTokenInput(false);
    } else {
      setShowTokenInput(true);
      setMapLoaded(false);
    }

    // Start timer interval for live job time updates
    timerIntervalRef.current = window.setInterval(() => {
      setTimerTick(t => t + 1);
    }, 60000); // Update every minute

    return () => {
      stopLocationTracking();
      // Clear timer interval
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      // Only remove if the map was fully initialized with a container
      if (mapInstanceRef.current && mapInstanceRef.current.getContainer()) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          console.warn("[Mapbox] Cleanup error ignored:", e);
        }
      }
      mapInstanceRef.current = null;
    };
  }, []);

  const applyMapChromeBottomOffset = useCallback(() => {
    const root = mapRef.current;
    if (!root) return;

    const bottomLeft = root.querySelector('.mapboxgl-ctrl-bottom-left') as HTMLElement | null;
    if (bottomLeft) bottomLeft.style.bottom = `${MAP_CHROME_BOTTOM_OFFSET_PX}px`;

    const bottomRight = root.querySelector('.mapboxgl-ctrl-bottom-right') as HTMLElement | null;
    if (bottomRight) bottomRight.style.bottom = `${MAP_CHROME_BOTTOM_OFFSET_PX}px`;
  }, []);

  // Apply control offsets reliably (HMR / style reloads can prevent the map "load" handler from re-running)
  useEffect(() => {
    if (showTokenInput) return;
    const timers = [0, 50, 250, 800].map((ms) =>
      window.setTimeout(() => applyMapChromeBottomOffset(), ms)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [mapLoaded, showTokenInput, applyMapChromeBottomOffset]);

  // Initialize map when location is enabled - with delay to ensure DOM is ready
  useEffect(() => {
    if (!mapLoaded && locationEnabled && !showTokenInput) {
      // Small delay to ensure DOM container is mounted after showTokenInput changes
      const timerId = setTimeout(() => {
        if (mapRef.current) {
          initializeMap();
        }
      }, 100);
      return () => clearTimeout(timerId);
    }
  }, [locationEnabled, mapLoaded, showTokenInput]);

  useEffect(() => {
    if (mapLoaded && currentLocation) {
      updateMapView();
    }
  }, [leads, currentLocation, mapLoaded, statusFilters]);

  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate("/auth");
        return;
      }

      setCurrentUserId(session.user.id);

      // Check user role - only field_agent can access this page
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      const userRoles = roles?.map(r => r.role) || [];
      const isFieldAgent = userRoles.includes("field_agent");
      const isAdmin = userRoles.includes("admin");

      // If user is admin only (not field agent), redirect to admin
      if (isAdmin && !isFieldAgent) {
        navigate("/admin");
        return;
      }

      // Fetch user profile for name and home base
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, home_base_lat, home_base_lng")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.full_name) {
        setUserName(profile.full_name);
      }
      if (profile?.home_base_lat && profile?.home_base_lng) {
        setHomeBaseLat(profile.home_base_lat);
        setHomeBaseLng(profile.home_base_lng);
      }

      fetchLeads();
      subscribeToLeads();
    } catch (error: any) {
      console.error("Auth check error:", error);
      navigate("/auth");
    } finally {
      setLoading(false);
    }
  };

  // fetchLeads now delegated to offlineLeads hook - kept for subscription callback
  const fetchLeads = useCallback(() => {
    if (isOnline) {
      offlineLeads.refetch();
    }
  }, [isOnline, offlineLeads]);

  const subscribeToLeads = () => {
    const channel = supabase
      .channel("leads-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        () => {
          if (isOnline) {
            fetchLeads();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const startLocationTracking = () => {
    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          setCurrentLocation({ lat: latitude, lng: longitude });

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          await supabase
            .from("agent_locations")
            .upsert(
              {
                agent_id: user.id,
                latitude,
                longitude,
                is_available: true,
                last_updated: new Date().toISOString(),
              },
              { onConflict: "agent_id" }
            );

          setLocationEnabled(true);
        },
        (error) => {
          console.error("Location error:", error);
          toast({
            title: "Location Error",
            description: "Unable to access your location",
            variant: "destructive",
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    }
  };

  const stopLocationTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  // Accept/Claim a lead - Now uses offline-first approach
  const handleAcceptLead = async (leadId: string) => {
    setLoadingAction('accept');

    try {
      // Find the lead to get customer_id for notification
      const lead = leads.find(l => l.id === leadId);

      await offlineLeads.acceptLead(leadId);

      // Send WhatsApp notification (only if online and customer_id exists)
      if (isOnline && lead?.customer_id) {
        notifyJobAssigned(
          lead.customer_id,
          leadId,
          userName || "Your technician",
          "within 2 hours"
        ).catch(err => console.error('[Notification] Job assigned error:', err));
      }

      // Close detail sheet and switch to active tab
      setDetailSheetOpen(false);
      setMobileTab('active');

      toast({
        title: "Lead Claimed! 🎉",
        description: isOnline ? "You've been assigned to this lead" : "Saved offline - will sync when connected",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to accept lead",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Start job - Now uses offline-first approach with duration tracking
  const handleStartJob = async (leadId: string, durationMinutes: number) => {
    setLoadingAction('start');

    try {
      const lead = leads.find(l => l.id === leadId);
      const now = new Date();
      const estimatedEnd = new Date(now.getTime() + durationMinutes * 60 * 1000);

      // Update lead with duration info
      if (isOnline) {
        await supabase
          .from("leads")
          .update({
            status: "in_progress",
            started_at: now.toISOString(),
            actual_start_time: now.toISOString(),
            estimated_duration_minutes: durationMinutes,
            estimated_end_time: estimatedEnd.toISOString(),
          })
          .eq("id", leadId);

        // Set availability to busy
        await availability.startJob(durationMinutes);
      } else {
        // Offline fallback
        await offlineLeads.startJob(leadId);
      }

      // Send WhatsApp notification (only if online and customer_id exists)
      if (isOnline && lead?.customer_id) {
        // Calculate ETA based on distance
        let etaMinutes = 30; // default estimate
        if (currentLocation && lead.latitude && lead.longitude) {
          const distanceKm = calculateDistanceKm(
            currentLocation.lat,
            currentLocation.lng,
            Number(lead.latitude),
            Number(lead.longitude)
          );
          // Rough estimate: 2 minutes per km in urban traffic
          etaMinutes = Math.max(10, Math.round(distanceKm * 2));
        }

        notifyTechEnRoute(
          lead.customer_id,
          leadId,
          userName || "Your technician",
          etaMinutes
        ).catch(err => console.error('[Notification] Tech en route error:', err));
      }

      // Refetch leads to get updated data
      offlineLeads.refetch();
      setDetailSheetOpen(false);

      const formatDuration = (mins: number) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h > 0 && m > 0) return `${h}h ${m}m`;
        if (h > 0) return `${h}h`;
        return `${m}m`;
      };

      toast({
        title: "Job Started! 🚀",
        description: `Estimated duration: ${formatDuration(durationMinutes)}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start job",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Complete job - Now uses offline-first approach with availability update
  const handleCompleteJob = async (leadId: string) => {
    setLoadingAction('complete');

    try {
      await offlineLeads.completeJob(leadId);

      // Update availability to available
      await availability.completeJob();

      setDetailSheetOpen(false);

      toast({
        title: "Job Complete! ✅",
        description: isOnline ? "Great work! You're now available for new leads." : "Saved offline - will sync when connected",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to complete job",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Release lead back to available pool - Now uses offline-first approach
  const handleReleaseLead = async (leadId: string) => {
    setLoadingAction('release');

    try {
      await offlineLeads.releaseLead(leadId);
      setDetailSheetOpen(false);
      setMobileTab('available');

      toast({
        title: "Lead Released",
        description: isOnline ? "Lead is now available for other agents" : "Saved offline - will sync when connected",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to release lead",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSignOut = async () => {
    stopLocationTracking();
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    return calculateDistanceKm(lat1, lon1, lat2, lon2);
  };

  // Manual location refresh
  const refreshLocation = useCallback(async () => {
    if (!("geolocation" in navigator)) return;

    setLocationUpdating(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const { latitude, longitude } = position.coords;
      setCurrentLocation({ lat: latitude, lng: longitude });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("agent_locations").upsert({
          agent_id: user.id,
          latitude,
          longitude,
          is_available: isAvailableForLeads,
          last_updated: new Date().toISOString(),
        }, { onConflict: "agent_id" });
      }

      toast({
        title: "Location Updated 📍",
        description: "Your position has been refreshed",
      });
    } catch (error) {
      toast({
        title: "Location Error",
        description: "Could not update your location",
        variant: "destructive",
      });
    } finally {
      setLocationUpdating(false);
    }
  }, [isAvailableForLeads, toast]);

  const handleTokenSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const token = formData.get('token') as string;

    if (token && token.startsWith('pk.')) {
      localStorage.setItem('mapbox_token', token);
      setMapboxToken(token);
      setShowTokenInput(false);
      setMapLoaded(false);

      // Initialize map if location is already enabled
      if (locationEnabled && mapRef.current) {
        initializeMap();
      }
    } else {
      toast({
        title: "Invalid Token",
        description: "Mapbox tokens start with 'pk.'",
        variant: "destructive",
      });
    }
  };

  const initializeMap = () => {
    if (!mapRef.current) {
      console.error("[Mapbox] Map container not mounted yet");
      return;
    }

    const token = (localStorage.getItem("mapbox_token") || "").trim();
    if (!token || !token.startsWith("pk.")) {
      console.error("[Mapbox] Missing/invalid token in localStorage");
      setShowTokenInput(true);
      return;
    }

    try {
      // Always set the token before creating the map
      mapboxgl.accessToken = token;

      // Re-init cleanly - check container exists before removing
      if (mapInstanceRef.current && mapInstanceRef.current.getContainer()) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          console.warn("[Mapbox] Cleanup during reinit ignored:", e);
        }
      }
      mapInstanceRef.current = null;
      markersRef.current.forEach((m) => {
        try { m.remove(); } catch (e) { /* ignore */ }
      });
      markersRef.current = [];
      setMapLoaded(false);

      mapInstanceRef.current = new mapboxgl.Map({
        container: mapRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: currentLocation
          ? [currentLocation.lng, currentLocation.lat]
          : [22.2922, -34.0522],
        zoom: 13,
      });

      mapInstanceRef.current.addControl(new mapboxgl.NavigationControl(), "bottom-left");

      // Apply offsets immediately (controls are typically mounted right after addControl)
      applyMapChromeBottomOffset();

      mapInstanceRef.current.on("load", () => {
        setMapLoaded(true);

        // Re-apply offsets after map style finishes loading
        applyMapChromeBottomOffset();
      });

      mapInstanceRef.current.on("error", (e) => {
        console.error("[Mapbox] error event:", e?.error ?? e);
        const status = (e as any)?.error?.status;
        if (status === 401 || status === 403) {
          toast({
            title: "Invalid Map Token",
            description: "Please verify your Mapbox public token and try again.",
            variant: "destructive",
          });
          setShowTokenInput(true);
          setMapLoaded(false);
        }
      });
    } catch (error) {
      console.error("[Mapbox] initializeMap threw:", error);
      toast({
        title: "Map Error",
        description: "Failed to initialize map. Please check your token.",
        variant: "destructive",
      });
      setShowTokenInput(true);
    }
  };

  const updateMapView = () => {
    if (!mapInstanceRef.current || !mapInstanceRef.current.getContainer() || !currentLocation) return;

    // Clear existing markers safely
    markersRef.current.forEach(marker => {
      try { marker.remove(); } catch (e) { /* ignore */ }
    });
    markersRef.current = [];

    // Add current location marker
    const userEl = createTeardropMarkerElement('#0077B6', undefined, 30, 38);

    const userMarker = new mapboxgl.Marker({ element: userEl, anchor: 'bottom' })
      .setLngLat([currentLocation.lng, currentLocation.lat])
      .setPopup(new mapboxgl.Popup({
        offset: [0, -25],
        maxWidth: "min(90vw, 280px)",
        anchor: "bottom"
      }).setHTML('<strong>Your Location</strong>'))
      .addTo(mapInstanceRef.current);

    markersRef.current.push(userMarker);

    // Add lead markers with status-based colors
    const getLeadColor = (status: string) => {
      switch (status) {
        case "pending":
        case "open":
        case "released": return "#ef4444"; // Red
        case "claimed":
        case "accepted": return "#eab308"; // Yellow
        case "in_progress": return "#22c55e"; // Green
        case "completed": return "#000000"; // Black
        default: return "#6b7280";
      }
    };

    // Filter leads based on active status filters
    const filteredLeads = leads.filter((lead) => {
      // Map various statuses to filter categories
      if (["pending", "open", "released"].includes(lead.status)) {
        return statusFilters.has("pending");
      }
      if (["claimed", "accepted"].includes(lead.status)) {
        return statusFilters.has("accepted");
      }
      if (lead.status === "in_progress") {
        return statusFilters.has("in_progress");
      }
      if (lead.status === "completed") {
        return statusFilters.has("completed");
      }
      return false;
    });

    filteredLeads.forEach((lead) => {
      const statusColor = getLeadColor(lead.status);
      const content = lead.status === "completed" ? "$" : undefined;

      const leadEl = createTeardropMarkerElement(statusColor, content);

      const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        lead.latitude,
        lead.longitude
      ).toFixed(1);

      // Build detailed popup HTML
      const popupStatusColor = statusColors[lead.status] || "#6b7280";
      const statusLabel = (lead.status || "").replace("_", " ");

      const popupHTML = `
        <div style="min-width: 200px; font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div style="font-weight: 600; font-size: 14px; color: #1f2937;">${lead.customer_name}</div>
              <div style="font-size: 11px; color: #6b7280;">${lead.service_type}</div>
            </div>
            <span style="background: ${popupStatusColor}; color: white; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 9999px; text-transform: capitalize;">${statusLabel}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #6b7280;">
            <span>${distance}km away</span>
            ${lead.created_at ? `• ${formatTimeAgo(lead.created_at)}` : ''}
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: #9ca3af;">Tap card for details</div>
        </div>
      `;

      const popup = new mapboxgl.Popup({
        offset: [0, -25],
        closeOnClick: true,
        maxWidth: "min(90vw, 280px)",
        anchor: "bottom"
      }).setHTML(popupHTML);

      // Click on marker opens detail sheet AND highlights card in list
      leadEl.addEventListener('click', () => {
        setSelectedLead(lead);
        setDetailSheetOpen(true);
        // Highlight the corresponding card in the list
        highlightLeadCard(lead.id);
      });

      const leadMarker = new mapboxgl.Marker({ element: leadEl, anchor: 'bottom' })
        .setLngLat([lead.longitude, lead.latitude])
        .setPopup(popup)
        .addTo(mapInstanceRef.current!);

      markersRef.current.push(leadMarker);
    });

    // Center map on user location
    mapInstanceRef.current.setCenter([currentLocation.lng, currentLocation.lat]);
  };

  const panToLocation = (lat: number, lng: number) => {
    if (mapInstanceRef.current && mapLoaded) {
      mapInstanceRef.current.flyTo({
        center: [lng, lat],
        zoom: 15,
        duration: 1000,
      });
    }
  };

  // Highlight a lead card in the list (with auto-scroll)
  const highlightLeadCard = useCallback((leadId: string) => {
    // Clear any existing timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    
    setHighlightedLeadId(leadId);
    
    // Auto-clear highlight after 3 seconds
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedLeadId(null);
    }, 3000);
  }, []);

  // Update visible leads based on map bounds
  const updateVisibleLeads = useCallback(() => {
    if (!mapInstanceRef.current || !mapLoaded) return;
    
    const bounds = mapInstanceRef.current.getBounds();
    const visible = new Set<string>();
    
    leads.forEach((lead) => {
      if (bounds.contains([lead.longitude, lead.latitude])) {
        visible.add(lead.id);
      }
    });
    
    setVisibleLeadIds(visible);
  }, [leads, mapLoaded]);

  // Listen to map move events to update visible leads
  useEffect(() => {
    if (!mapInstanceRef.current || !mapLoaded) return;
    
    const handleMoveEnd = () => updateVisibleLeads();
    mapInstanceRef.current.on('moveend', handleMoveEnd);
    
    // Initial calculation
    updateVisibleLeads();
    
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off('moveend', handleMoveEnd);
      }
    };
  }, [mapLoaded, updateVisibleLeads]);

  // Cleanup highlight timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const openLeadDetail = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailSheetOpen(true);
    panToLocation(lead.latitude, lead.longitude);
    highlightLeadCard(lead.id);
    if (isMobile) {
      setMobileSheetOpen(false);
      setShowMapOnMobile(true);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: "bg-red-500", text: "text-white", label: "Available" },
      open: { bg: "bg-red-500", text: "text-white", label: "Open" },
      released: { bg: "bg-orange-500", text: "text-white", label: "Released" },
      claimed: { bg: "bg-yellow-500", text: "text-black", label: "Claimed" },
      accepted: { bg: "bg-yellow-500", text: "text-black", label: "Accepted" },
      in_progress: { bg: "bg-green-500", text: "text-white", label: "In Progress" },
      completed: { bg: "bg-black", text: "text-white", label: "Completed" },
    };

    const config = statusConfig[status] || { bg: "bg-gray-500", text: "text-white", label: status };

    return (
      <Badge className={`${config.bg} ${config.text} text-xs`}>
        {config.label}
      </Badge>
    );
  };

  // Toggle availability
  // NOTE: Must be declared before any conditional returns to follow the Rules of Hooks.
  const toggleAvailability = useCallback(async (available: boolean) => {
    setIsAvailableForLeads(available);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update agent_locations table
    await supabase
      .from("agent_locations")
      .upsert({
        agent_id: user.id,
        latitude: currentLocation?.lat || 0,
        longitude: currentLocation?.lng || 0,
        is_available: available,
        last_updated: new Date().toISOString(),
      }, { onConflict: "agent_id" });

    toast({
      title: available ? "You're Available! ✅" : "You're Offline",
      description: available
        ? "You'll see new available leads"
        : "You won't see new leads, but can work on active jobs",
    });
  }, [currentLocation, toast]);

  // Filter and sort leads - MUST be before early returns to follow React hook rules
  const availableLeads = useMemo(() => leads
    .filter(l =>
      ["pending", "open", "released"].includes(l.status) && !l.assigned_agent_id
    )
    .sort((a, b) => {
      // Sort by priority first
      const priorityA = priorityOrder[a.priority || "normal"] ?? 2;
      const priorityB = priorityOrder[b.priority || "normal"] ?? 2;
      if (priorityA !== priorityB) return priorityA - priorityB;
      // Then by created_at
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }), [leads]);

  const activeLeads = useMemo(() => leads.filter(l =>
    ["claimed", "accepted", "in_progress"].includes(l.status) && l.assigned_agent_id === currentUserId
  ), [leads, currentUserId]);

  // Calculate filter counts for available leads
  const availableFilterCounts = useMemo(() => ({
    all: availableLeads.length,
    pending: availableLeads.filter(l => ["pending", "open", "released"].includes(l.status)).length,
    accepted: 0, // Not applicable for available
    in_progress: 0, // Not applicable for available
    completed: 0, // Not applicable for available
  }), [availableLeads]);

  // Calculate filter counts for active leads
  const activeFilterCounts = useMemo(() => ({
    all: activeLeads.length,
    pending: 0, // Not applicable for active
    accepted: activeLeads.filter(l => ["claimed", "accepted"].includes(l.status)).length,
    in_progress: activeLeads.filter(l => l.status === "in_progress").length,
    completed: 0, // Completed not shown in active
  }), [activeLeads]);

  // Apply list filters to available leads
  const filteredAvailableLeads = useMemo(() => {
    if (availableListFilter === "all") return availableLeads;
    // For available list, only "pending" filter makes sense
    if (availableListFilter === "pending") {
      return availableLeads.filter(l => ["pending", "open", "released"].includes(l.status));
    }
    return availableLeads;
  }, [availableLeads, availableListFilter]);

  // Apply list filters to active leads
  const filteredActiveLeads = useMemo(() => {
    if (activeListFilter === "all") return activeLeads;
    if (activeListFilter === "accepted") {
      return activeLeads.filter(l => ["claimed", "accepted"].includes(l.status));
    }
    if (activeListFilter === "in_progress") {
      return activeLeads.filter(l => l.status === "in_progress");
    }
    return activeLeads;
  }, [activeLeads, activeListFilter]);

  // Filtered available leads based on availability toggle
  const displayedAvailableLeads = useMemo(() => 
    isAvailableForLeads ? filteredAvailableLeads : []
  , [isAvailableForLeads, filteredAvailableLeads]);

  // Check if a lead is visible on the map (for dimming non-visible cards)
  const isLeadVisible = useCallback((leadId: string) => {
    // If no bounds tracking yet, consider all visible
    if (visibleLeadIds.size === 0) return true;
    return visibleLeadIds.has(leadId);
  }, [visibleLeadIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-[#0077B6]" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const footerLeftContent = isMobile ? (
    <Button
      variant={mobileSheetOpen ? "secondary" : "ghost"}
      size="sm"
      onClick={() => {
        setShowMapOnMobile(!showMapOnMobile);
        if (!showMapOnMobile) {
          setMobileSheetOpen(false);
        } else {
          setMobileSheetOpen(true);
        }
      }}
      className={mobileSheetOpen ? "bg-white text-blue-600 hover:bg-blue-50 gap-2" : "text-white hover:bg-blue-500 gap-2"}
    >
      {showMapOnMobile ? (
        <>
          <List className="h-4 w-4" />
          <span className="hidden sm:inline">Show Leads</span>
        </>
      ) : (
        <>
          <Map className="h-4 w-4" />
          <span className="hidden sm:inline">Show Map</span>
        </>
      )}
    </Button>
  ) : null;

  return (
    <Layout footerLeftContent={footerLeftContent}>
      <div className="h-screen flex flex-col overflow-hidden pb-12">
        {/* Header - Cyan Theme */}
        <header className="backdrop-blur border-b px-3 md:px-4 py-2 md:py-3 flex items-center justify-between z-20" style={{ backgroundColor: '#0077B6', borderColor: '#006699', color: '#FFFFFF' }}>
          <div className="flex items-center gap-2 md:gap-3">
            <img src={logo} alt="Be Cool Logo" className="h-10 md:h-[4.5rem]" />
            <div className="hidden md:block h-6 w-px bg-white/30" />
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="hidden md:flex gap-1 text-white hover:bg-white/20">
              <ArrowLeft className="h-4 w-4 text-white" />
              Dashboard
            </Button>
            <div className="hidden md:block h-6 w-px bg-white/30" />
            <div className="flex flex-col">
              <span className="font-semibold text-sm text-white">Field Agent</span>
              {userName && <span className="text-xs text-white/80 hidden md:block">{userName}</span>}
            </div>
            {locationEnabled ? (
              <Badge variant="outline" className="text-xs bg-green-500/20 text-white border-green-400">
                <Navigation className="h-3 w-3 mr-1" />
                {isMobile ? "" : "Live"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-red-500/20 text-white border-red-400">
                No GPS
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Offline/Online Status Indicator */}
            <OfflineIndicator
              isOnline={isOnline}
              syncStatus={syncStatus}
              onRetrySync={retrySyncFailedOperations}
              onClearFailed={clearFailedOperations}
              onDeleteOperation={deleteOperation}
              getPendingOperations={getPendingOperationsList}
              compact={isMobile}
            />
            <div className="h-5 w-px bg-white/30" />
            {/* Availability Toggle with Status Indicator */}
            <div className="flex items-center gap-2">
              <AvailabilityIndicator
                status={availability.status}
                isInBufferWindow={availability.isInBufferWindow}
                nextAvailableText={availability.formatNextAvailable()}
                compact={isMobile}
              />
              <Switch
                checked={isAvailableForLeads}
                onCheckedChange={toggleAvailability}
                className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-white/30"
              />
            </div>
            <div className="h-5 w-px bg-white/30" />
            {isMobile && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-white hover:bg-white/20 p-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-white hover:bg-white/20 p-2">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Main Content - Full Page Map with Overlays */}
        <div className="flex-1 relative">
          {/* Map Container */}
          {showTokenInput ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 p-6 z-10">
              <div className="bg-card border rounded-lg p-6 max-w-md w-full shadow-lg">
                <div className="text-center space-y-2 mb-4">
                  <MapPin className="h-8 w-8 text-[#0077B6] mx-auto" />
                  <h3 className="font-semibold">Mapbox Token Required</h3>
                  <p className="text-sm text-muted-foreground">
                    Get your public token from{" "}
                    <a
                      href="https://account.mapbox.com/access-tokens/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#0077B6] underline"
                    >
                      Mapbox Account
                    </a>
                  </p>
                </div>
                <form onSubmit={handleTokenSubmit} className="space-y-3">
                  <input
                    type="text"
                    name="token"
                    placeholder="pk.eyJ..."
                    className="w-full px-3 py-2 border-0 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0077B6] focus:ring-offset-2 placeholder:text-white/70"
                    style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                    required
                  />
                  <Button type="submit" className="w-full" style={{ backgroundColor: '#0077B6' }}>
                    Load Map
                  </Button>
                </form>
              </div>
            </div>
          ) : !locationEnabled ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="text-center space-y-2 bg-card p-6 rounded-lg border shadow-lg">
                <Navigation className="h-8 w-8 text-[#0077B6] mx-auto animate-pulse" />
                <p className="text-sm font-medium">Waiting for location access...</p>
                <p className="text-xs text-muted-foreground">Please allow location permissions</p>
              </div>
            </div>
          ) : (
            <>
              <div ref={mapRef} className="absolute inset-0" />

              {!mapLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
                  <div className="text-center space-y-2 bg-card p-6 rounded-lg border shadow-lg">
                    <Loader2 className="h-8 w-8 animate-spin text-[#0077B6] mx-auto" />
                    <p className="text-sm text-muted-foreground">Loading map...</p>
                  </div>
                </div>
              )}
            </>
          )}
          {/* Manual Location Refresh */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={refreshLocation}
                disabled={locationUpdating}
                className="text-white hover:bg-white/20 p-2"
              >
                {locationUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Update My Location</TooltipContent>
          </Tooltip>
          {/* Desktop: Left Panel - Available Leads */}
          <div className="hidden md:flex absolute left-3 top-3 bottom-3 w-72 z-10 flex-col pointer-events-none">
            <div
              className="backdrop-blur-md border border-white/20 rounded-lg shadow-[0_0_30px_rgba(34,197,94,0.15)] overflow-hidden flex flex-col max-h-full pointer-events-auto"
              style={{ background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(34, 197, 94, 0.08) 100%)' }}
            >
              <div className="p-3 border-b border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <h3 className="font-semibold text-sm text-foreground">Available Leads</h3>
                  </div>
                  <Badge variant="secondary" className="text-xs">{displayedAvailableLeads.length}</Badge>
                </div>
                {/* Filter Pills */}
                <LeadListFilterPills
                  activeFilter={availableListFilter}
                  onFilterChange={setAvailableListFilter}
                  availableStatuses={["all", "pending"]}
                  counts={availableFilterCounts}
                  compact
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {!isAvailableForLeads ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <p>You're offline</p>
                    <p className="text-xs mt-1">Turn on availability to see leads</p>
                  </div>
                ) : displayedAvailableLeads.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No available leads
                  </div>
                ) : (
                  displayedAvailableLeads.map((lead) => {
                    const distance = currentLocation
                      ? calculateDistance(currentLocation.lat, currentLocation.lng, lead.latitude, lead.longitude).toFixed(1)
                      : null;
                    return (
                      <FieldAgentLeadCard
                        key={lead.id}
                        lead={lead}
                        distance={distance}
                        variant="available"
                        isHighlighted={highlightedLeadId === lead.id}
                        isDimmed={visibleLeadIds.size > 0 && !isLeadVisible(lead.id)}
                        onCardClick={openLeadDetail}
                        onAccept={handleAcceptLead}
                        loadingAction={loadingAction}
                        scrollIntoView={highlightedLeadId === lead.id}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Desktop: Right Panel - Active Leads */}
          <div className="hidden md:flex absolute right-3 top-3 bottom-3 w-72 z-10 flex-col pointer-events-none">
            <div
              className="backdrop-blur-md border border-white/20 rounded-lg shadow-[0_0_30px_rgba(34,197,94,0.15)] overflow-hidden flex flex-col max-h-full pointer-events-auto"
              style={{ background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(34, 197, 94, 0.08) 100%)' }}
            >
              <div className="p-3 border-b border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <h3 className="font-semibold text-sm text-foreground">My Active Leads</h3>
                  </div>
                  <Badge variant="secondary" className="text-xs">{filteredActiveLeads.length}</Badge>
                </div>
                {/* Filter Pills */}
                <LeadListFilterPills
                  activeFilter={activeListFilter}
                  onFilterChange={setActiveListFilter}
                  availableStatuses={["all", "accepted", "in_progress"]}
                  counts={activeFilterCounts}
                  compact
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {filteredActiveLeads.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No active leads
                  </div>
                ) : (
                  filteredActiveLeads.map((lead) => {
                    const distance = currentLocation
                      ? calculateDistance(currentLocation.lat, currentLocation.lng, lead.latitude, lead.longitude).toFixed(1)
                      : null;
                    return (
                      <FieldAgentLeadCard
                        key={lead.id}
                        lead={lead}
                        distance={distance}
                        variant="active"
                        isHighlighted={highlightedLeadId === lead.id}
                        isDimmed={visibleLeadIds.size > 0 && !isLeadVisible(lead.id)}
                        onCardClick={openLeadDetail}
                        onStart={openLeadDetail}
                        onComplete={handleCompleteJob}
                        onRelease={handleReleaseLead}
                        loadingAction={loadingAction}
                        scrollIntoView={highlightedLeadId === lead.id}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Mobile toggle moved to footer */}

          {/* Mobile: Bottom Sheet */}
          {isMobile && (
            <div
              className={`absolute left-0 right-0 bottom-0 z-20 transition-all duration-300 ease-in-out ${mobileSheetOpen ? "h-[60vh]" : "h-auto"
                }`}
            >
              {/* Handle Bar */}
              <div
                className="bg-card/55 backdrop-blur-md border-t border-x rounded-t-2xl shadow-lg cursor-pointer"
                onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
              >
                <div className="flex items-center justify-center py-2">
                  <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                </div>
                <div className="flex items-center justify-between px-4 pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                      <span className="text-xs font-medium">{availableLeads.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                      <span className="text-xs font-medium">{activeLeads.length}</span>
                    </div>
                  </div>
                  {mobileSheetOpen ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Sheet Content */}
              {mobileSheetOpen && (
                <div
                  className="backdrop-blur-md h-full overflow-hidden flex flex-col"
                  style={{ background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(34, 197, 94, 0.08) 100%)' }}
                >
                  <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as "available" | "active")} className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-2 mx-4 mt-2 mb-1 flex-shrink-0" style={{ width: "calc(100% - 32px)" }}>
                      <TabsTrigger value="available" className="gap-2">
                        <List className="h-4 w-4" />
                        Available ({availableLeads.length})
                      </TabsTrigger>
                      <TabsTrigger value="active" className="gap-2">
                        <Clock className="h-4 w-4" />
                        Active ({activeLeads.length})
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent
                      value="available"
                      className="flex-1 mt-0"
                      style={{ maxHeight: 'calc(60vh - 100px)' }}
                    >
                      <PullToRefresh
                        onRefresh={async () => {
                          await offlineLeads.refetch();
                          toast({
                            title: "Refreshed",
                            description: "Available leads updated",
                          });
                        }}
                        className="h-full p-3 space-y-2"
                      >
                        {availableLeads.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            No available leads
                          </div>
                        ) : (
                          availableLeads.map((lead) => {
                            const distance = currentLocation
                              ? calculateDistance(currentLocation.lat, currentLocation.lng, lead.latitude, lead.longitude).toFixed(1)
                              : null;
                            return (
                              <Card
                                key={lead.id}
                                className="bg-gradient-to-r from-blue-100 to-slate-50 cursor-pointer active:from-blue-50 active:to-white transition-all shadow-md border-border/50"
                                onClick={() => openLeadDetail(lead)}
                              >
                                <CardContent className="p-3 space-y-2">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="font-medium text-sm">{lead.customer_name}</p>
                                      <p className="text-xs text-muted-foreground">{lead.service_type}</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                      {getStatusBadge(lead.status)}
                                      {distance && (
                                        <span className="text-xs text-muted-foreground">{distance}km</span>
                                      )}
                                    </div>
                                  </div>
                                  {lead.created_at && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {formatTimeAgo(lead.created_at)}
                                    </p>
                                  )}
                                  <Button
                                    size="sm"
                                    className="w-full h-10 rounded-full font-semibold"
                                    style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAcceptLead(lead.id);
                                    }}
                                    disabled={!!loadingAction}
                                  >
                                    {loadingAction === 'accept' ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      "Accept Lead"
                                    )}
                                  </Button>
                                </CardContent>
                              </Card>
                            );
                          })
                        )}
                      </PullToRefresh>
                    </TabsContent>

                    <TabsContent
                      value="active"
                      className="flex-1 mt-0"
                      style={{ maxHeight: 'calc(60vh - 100px)' }}
                    >
                      <PullToRefresh
                        onRefresh={async () => {
                          await offlineLeads.refetch();
                          toast({
                            title: "Refreshed",
                            description: "Active leads updated",
                          });
                        }}
                        className="h-full p-3 space-y-2"
                      >
                        {activeLeads.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            No active leads
                          </div>
                        ) : (
                          activeLeads.map((lead) => {
                            const distance = currentLocation
                              ? calculateDistance(currentLocation.lat, currentLocation.lng, lead.latitude, lead.longitude).toFixed(1)
                              : null;
                            return (
                              <Card
                                key={lead.id}
                                className="bg-gradient-to-r from-blue-100 to-slate-50 cursor-pointer active:from-blue-50 active:to-white transition-all shadow-md border-border/50"
                                onClick={() => openLeadDetail(lead)}
                              >
                                <CardContent className="p-3 space-y-2">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="font-medium text-sm">{lead.customer_name}</p>
                                      <p className="text-xs text-muted-foreground">{lead.service_type}</p>
                                    </div>
                                    {getStatusBadge(lead.status)}
                                  </div>
                                  {distance && (
                                    <p className="text-xs text-muted-foreground">{distance}km away</p>
                                  )}
                                  {lead.created_at && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {formatTimeAgo(lead.created_at)}
                                    </p>
                                  )}
                                  <div className="flex gap-2">
                                    {["claimed", "accepted"].includes(lead.status) && (
                                      <Button
                                        size="sm"
                                        className="flex-1 h-10 rounded-full font-semibold"
                                        style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openLeadDetail(lead);
                                        }}
                                      >
                                        Start Job
                                      </Button>
                                    )}
                                    {lead.status === "in_progress" && (
                                      <Button
                                        size="sm"
                                        className="flex-1 h-10 rounded-full font-semibold bg-green-600 hover:bg-green-700"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCompleteJob(lead.id);
                                        }}
                                        disabled={!!loadingAction}
                                      >
                                        {loadingAction === 'complete' ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Complete"
                                        )}
                                      </Button>
                                    )}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-10 px-3 rounded-full"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReleaseLead(lead.id);
                                      }}
                                      disabled={!!loadingAction}
                                    >
                                      Release
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-10 px-3"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(
                                          `https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`,
                                          "_blank"
                                        );
                                      }}
                                    >
                                      <Navigation className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  {/* Job Progress Bar for in_progress leads */}
                                  {lead.status === "in_progress" && lead.started_at && (
                                    <LeadCardProgress
                                      startedAt={lead.started_at}
                                      estimatedDurationMinutes={lead.estimated_duration_minutes}
                                      estimatedEndTime={lead.estimated_end_time}
                                      compact
                                    />
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })
                        )}
                      </PullToRefresh>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          )}

          {/* Status Filter Buttons - All Devices */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10">
            <StatusFilterButtons
              activeFilters={statusFilters}
              onToggle={(status) => {
                setStatusFilters((prev) => {
                  const next = new Set(prev);
                  if (next.has(status)) {
                    next.delete(status);
                  } else {
                    next.add(status);
                  }
                  return next;
                });
              }}
              compact={isMobile}
            />
          </div>
        </div>

        {/* Lead Detail Sheet */}
        <LeadDetailSheet
          lead={selectedLead}
          open={detailSheetOpen}
          onClose={() => setDetailSheetOpen(false)}
          onAccept={handleAcceptLead}
          onStart={handleStartJob}
          onComplete={handleCompleteJob}
          onRelease={handleReleaseLead}
          currentUserId={currentUserId}
          loadingAction={loadingAction}
          onLeadUpdated={() => offlineLeads.refetch()}
        />
      </div>
    </Layout>
  );
};

export default FieldAgent;
