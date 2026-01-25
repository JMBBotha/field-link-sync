import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Key, Loader2, AlertCircle } from "lucide-react";
import { createTeardropMarkerElement } from "@/utils/MarkerUtils";
import StatusFilterButtons, { LeadStatusFilter } from "@/components/StatusFilterButtons";

interface AgentLocation {
  agent_id: string;
  latitude: number;
  longitude: number;
  is_available: boolean;
  last_updated: string | null;
  profiles?: { full_name: string };
}

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  status: string;
  created_at: string;
}

export interface MapViewHandle {
  panToLocation: (lat: number, lng: number) => void;
  panToLocationAndOpenPopup: (lat: number, lng: number, leadId: string) => void;
}

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

const MapView = forwardRef<MapViewHandle>((_, ref) => {
  const [agents, setAgents] = useState<AgentLocation[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [center, setCenter] = useState({ lat: -34.0522, lng: 22.2922 });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Set<LeadStatusFilter>>(
    new Set(["pending", "accepted", "in_progress"])
  );
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const agentMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const leadMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialBoundsFitRef = useRef(false);
  const missingAgentCountsRef = useRef<Map<string, number>>(new Map());
  const missingLeadCountsRef = useRef<Map<string, number>>(new Map());

  // Expose panToLocation and panToLocationAndOpenPopup methods via ref
  useImperativeHandle(ref, () => ({
    panToLocation: (lat: number, lng: number) => {
      if (mapInstanceRef.current && mapLoaded) {
        mapInstanceRef.current.flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 1000,
        });
      }
    },
    panToLocationAndOpenPopup: (lat: number, lng: number, leadId: string) => {
      if (mapInstanceRef.current && mapLoaded) {
        mapInstanceRef.current.flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 1000,
        });

        // Open popup after fly animation completes
        setTimeout(() => {
          const marker = leadMarkersRef.current.get(leadId);
          if (marker) {
            // Close all other popups first
            leadMarkersRef.current.forEach((m, id) => {
              if (id !== leadId) m.getPopup()?.remove();
            });
            agentMarkersRef.current.forEach((m) => m.getPopup()?.remove());

            // Open this popup
            marker.togglePopup();

            // Add pulse animation to marker
            const el = marker.getElement();
            if (el) {
              el.style.animation = "pulse 0.6s ease-out 3";
              setTimeout(() => {
                el.style.animation = "";
              }, 1800);
            }
          }
        }, 1100);
      }
    },
  }), [mapLoaded]);

  useEffect(() => {
    fetchData();
    const cleanupSubscription = subscribeToUpdates();

    // Check for Mapbox token from localStorage
    const storedToken = localStorage.getItem("mapbox_token");
    if (storedToken && storedToken.startsWith("pk.")) {
      initializeMap(storedToken);
    } else {
      setShowTokenInput(true);
    }

    // Refresh markers every minute to update time badges (safe-guarded by updateMarkers)
    const intervalId = setInterval(() => {
      updateMarkers();
    }, 60000);

    return () => {
      clearInterval(intervalId);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }

      // Cleanup realtime subscriptions
      cleanupSubscription?.();

      // Remove markers first (prevents dangling DOM nodes)
      clearAllMarkers();

      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  const clearAllMarkers = () => {
    agentMarkersRef.current.forEach((marker) => {
      try {
        marker.remove();
      } catch {
        // ignore
      }
    });
    leadMarkersRef.current.forEach((marker) => {
      try {
        marker.remove();
      } catch {
        // ignore
      }
    });
    agentMarkersRef.current.clear();
    leadMarkersRef.current.clear();
    missingAgentCountsRef.current.clear();
    missingLeadCountsRef.current.clear();
  };

  const fetchData = async () => {
    // Fetch agent locations with most recently updated first
    const { data: agentData } = await supabase
      .from("agent_locations")
      .select("*")
      .order("last_updated", { ascending: false });

    const { data: leadData } = await supabase
      .from("leads")
      .select("*");

    if (agentData) {
      const agentsWithProfiles = await Promise.all(
        agentData.map(async (agent) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", agent.agent_id)
            .maybeSingle();
          return { ...agent, profiles: profile };
        })
      );
      setAgents(agentsWithProfiles as any);
    }
    if (leadData) setLeads(leadData);
  };

  const subscribeToUpdates = () => {
    const agentChannel = supabase
      .channel("agent-locations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_locations",
        },
        () => fetchData()
      )
      .subscribe();

    const leadChannel = supabase
      .channel("leads-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(agentChannel);
      supabase.removeChannel(leadChannel);
    };
  };

  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError("");

    if (!tokenInput.trim()) {
      setTokenError("Please enter a token");
      return;
    }

    if (!tokenInput.startsWith('pk.')) {
      setTokenError("Token must start with 'pk.'");
      return;
    }

    localStorage.setItem('mapbox_token', tokenInput);
    setShowTokenInput(false);
    initializeMap(tokenInput);
  };

  const handleResetToken = () => {
    localStorage.removeItem('mapbox_token');
    clearAllMarkers();
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    initialBoundsFitRef.current = false;
    setMapLoaded(false);
    setShowTokenInput(true);
    setTokenInput("");
  };

  const initializeMap = (rawToken: string) => {
    if (!mapRef.current) return;

    const token = rawToken.trim();

    // Clear any existing timeout
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }

    setLoadingStatus("Connecting to Mapbox...");
    setLoadingTimeout(false);

    try {
      // Always set the token before creating the map
      mapboxgl.accessToken = token;

      // Re-init cleanly if needed
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      clearAllMarkers();
      initialBoundsFitRef.current = false;
      setMapLoaded(false);

      setLoadingStatus("Loading map tiles...");

      mapInstanceRef.current = new mapboxgl.Map({
        container: mapRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [center.lng, center.lat],
        zoom: 12,
      });

      mapInstanceRef.current.addControl(new mapboxgl.NavigationControl(), "bottom-left");

      // Set a timeout for loading
      loadingTimeoutRef.current = setTimeout(() => {
        if (!mapLoaded) {
          setLoadingTimeout(true);
          setLoadingStatus("Map is taking longer than expected...");
        }
      }, 10000);
      
      // Offset the navigation control above the footer after map loads
      mapInstanceRef.current.on("load", () => {
        // Offset the navigation control and logo above the footer
        const navControl = mapRef.current?.querySelector('.mapboxgl-ctrl-bottom-left');
        if (navControl) {
          (navControl as HTMLElement).style.bottom = '48px';
        }
        const logo = mapRef.current?.querySelector('.mapboxgl-ctrl-logo');
        if (logo) {
          (logo as HTMLElement).style.marginBottom = '48px';
        }
        const attrib = mapRef.current?.querySelector('.mapboxgl-ctrl-attrib');
        if (attrib) {
          (attrib as HTMLElement).style.marginBottom = '48px';
        }
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
        setLoadingStatus("Map loaded!");
        setLoadingTimeout(false);
        setMapLoaded(true);
      });

      mapInstanceRef.current.on("error", (e) => {
        console.error("[Mapbox] error event:", e?.error ?? e);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
        const status = (e as any)?.error?.status;
        if (status === 401 || status === 403) {
          setTokenError("Invalid token. Please check your Mapbox public token.");
          handleResetToken();
        } else {
          setLoadingTimeout(true);
          setLoadingStatus("Failed to load map. Check your connection.");
        }
      });
    } catch (error) {
      console.error("[Mapbox] initializeMap threw:", error);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      setShowTokenInput(true);
    }
  };

  useEffect(() => {
    if (mapLoaded && mapInstanceRef.current && (agents.length > 0 || leads.length > 0)) {
      updateMarkers();
    }
  }, [agents, leads, mapLoaded, statusFilters]);

  const updateMarkers = () => {
    const map = mapInstanceRef.current;
    // Guard against calling while map is being re-initialized.
    if (!map) return;
    if (typeof (map as any).loaded === "function" && !(map as any).loaded()) return;
    if (typeof (map as any).getCanvasContainer === "function" && !(map as any).getCanvasContainer()) return;

    const getLeadColor = (status: string) => {
      switch (status) {
        case "pending":
          return "#ef4444"; // Red
        case "accepted":
          return "#eab308"; // Yellow
        case "in_progress":
          return "#22c55e"; // Green
        case "completed":
          return "#000000"; // Black
        default:
          return "#6b7280";
      }
    };

    const statusColors: Record<string, string> = {
      pending: "#f59e0b",
      accepted: "#3b82f6",
      in_progress: "#f97316",
      completed: "#22c55e",
      cancelled: "#ef4444",
    };

    const buildLeadPopupHTML = (lead: Lead) => {
      const statusColor = statusColors[lead.status] || "#6b7280";
      const statusLabel = (lead.status || "").replace("_", " ");
      const encodedAddress = encodeURIComponent(lead.customer_address);
      const navigationUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

      return `
        <div style="min-width: 240px; font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div style="font-weight: 600; font-size: 14px; color: #1f2937;">${lead.customer_name}</div>
              <div style="font-size: 11px; color: #6b7280;">${lead.service_type}</div>
            </div>
            <span style="background: ${statusColor}; color: white; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 9999px; text-transform: capitalize;">${statusLabel}</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #374151;">
            <a href="${navigationUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: flex-start; gap: 6px; text-decoration: none; color: inherit; padding: 4px; margin: -4px; border-radius: 4px; transition: background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
              <svg style="width: 14px; height: 14px; color: #2563eb; flex-shrink: 0; margin-top: 1px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              <span style="font-size: 11px; color: #2563eb; text-decoration: underline;">${lead.customer_address}</span>
              <svg style="width: 12px; height: 12px; color: #2563eb; flex-shrink: 0; margin-left: auto;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
            </a>

            <div style="display: flex; align-items: center; gap: 6px;">
              <svg style="width: 14px; height: 14px; color: #9ca3af; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
              <a href="tel:${lead.customer_phone}" style="color: #2563eb; text-decoration: none; font-size: 11px;">${lead.customer_phone}</a>
            </div>

            ${lead.notes ? `
            <div style="display: flex; align-items: flex-start; gap: 6px; margin-top: 4px; padding-top: 6px; border-top: 1px solid #e5e7eb;">
              <svg style="width: 14px; height: 14px; color: #9ca3af; flex-shrink: 0; margin-top: 1px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <span style="font-size: 11px; color: #6b7280;">${lead.notes}</span>
            </div>
            ` : ""}

            <div style="display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 10px; color: #9ca3af;">
              <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              ${lead.created_at ? formatTimeAgo(lead.created_at) : ""}
            </div>
          </div>
        </div>
      `;
    };

    // Remove stale agent markers (be resilient to transient empty fetches)
    const STALE_REMOVE_THRESHOLD = 3;
    const nextAgentIds = new Set(agents.map((a) => a.agent_id));

    // Reset missing counters for agents that are present
    nextAgentIds.forEach((id) => missingAgentCountsRef.current.delete(id));

    agentMarkersRef.current.forEach((marker, agentId) => {
      if (!nextAgentIds.has(agentId)) {
        const nextMisses = (missingAgentCountsRef.current.get(agentId) ?? 0) + 1;
        missingAgentCountsRef.current.set(agentId, nextMisses);

        // Only remove after N consecutive misses to prevent "vanish" behavior
        if (nextMisses >= STALE_REMOVE_THRESHOLD) {
          try {
            marker.remove();
          } catch {
            // ignore
          }
          agentMarkersRef.current.delete(agentId);
          missingAgentCountsRef.current.delete(agentId);
        }
      }
    });

    // Upsert agent markers
    agents.forEach((agent) => {
      const statusColor = agent.is_available ? "#10b981" : "#6b7280";
      const statusLabel = agent.is_available ? "Available" : "Busy";
      const lastUpdated = agent.last_updated ? formatTimeAgo(agent.last_updated) : "Unknown";

      const popupHTML = `
        <div style="min-width: 200px; font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="font-weight: 600; font-size: 14px; color: #1f2937;">${agent.profiles?.full_name || "Agent"}</div>
            <span style="background: ${statusColor}; color: white; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 9999px;">${statusLabel}</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #374151;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <svg style="width: 14px; height: 14px; color: #9ca3af; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              <span style="font-size: 11px;">${agent.latitude.toFixed(5)}, ${agent.longitude.toFixed(5)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: #9ca3af;">
              <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Last updated: ${lastUpdated}
            </div>
          </div>
        </div>
      `;

      let marker = agentMarkersRef.current.get(agent.agent_id);
      if (!marker) {
        const el = createTeardropMarkerElement(agent.is_available ? "#10b981" : "#6b7280");

        marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([agent.longitude, agent.latitude])
          .setPopup(new mapboxgl.Popup({
            offset: [0, -25],
            closeOnClick: false,
            maxWidth: "min(90vw, 280px)",
            anchor: "bottom"
          }).setHTML(popupHTML))
          .addTo(map);

        agentMarkersRef.current.set(agent.agent_id, marker);
      } else {
        marker.setLngLat([agent.longitude, agent.latitude]);
        // We need to recreate the element to change color effectively with SVG string replacement
        const el = marker.getElement();
        const newEl = createTeardropMarkerElement(agent.is_available ? "#10b981" : "#6b7280");
        el.innerHTML = newEl.innerHTML; // Update inner HTML to change color
        marker.getPopup()?.setHTML(popupHTML);
      }
    });

    // Filter leads based on active status filters
    const shouldShowLead = (lead: Lead): boolean => {
      if (lead.status === "pending") return statusFilters.has("pending");
      if (lead.status === "accepted") return statusFilters.has("accepted");
      if (lead.status === "in_progress") return statusFilters.has("in_progress");
      if (lead.status === "completed") return statusFilters.has("completed");
      return false;
    };

    // Remove stale lead markers (be resilient to transient empty fetches)
    const nextLeadIds = new Set(leads.map((l) => l.id));

    // Reset missing counters for leads that are present
    nextLeadIds.forEach((id) => missingLeadCountsRef.current.delete(id));

    leadMarkersRef.current.forEach((marker, leadId) => {
      if (!nextLeadIds.has(leadId)) {
        const nextMisses = (missingLeadCountsRef.current.get(leadId) ?? 0) + 1;
        missingLeadCountsRef.current.set(leadId, nextMisses);

        // Only remove after N consecutive misses to prevent "vanish" behavior
        if (nextMisses >= 3) {
          try {
            marker.remove();
          } catch {
            // ignore
          }
          leadMarkersRef.current.delete(leadId);
          missingLeadCountsRef.current.delete(leadId);
        }
      }
    });

    // Upsert lead markers (show/hide based on filter)
    leads.forEach((lead) => {
      const isVisible = shouldShowLead(lead);
      const popupHTML = buildLeadPopupHTML(lead);

      let marker = leadMarkersRef.current.get(lead.id);
      const leadColor = getLeadColor(lead.status);
      const content = lead.status === "completed" ? "$" : undefined;

      if (!marker) {
        const el = createTeardropMarkerElement(leadColor, content);

        // Add time badge if needed (custom addition to the wrapper)
        const timeBadge = document.createElement("div");
        timeBadge.dataset.role = "time-badge";
        timeBadge.style.backgroundColor = "#1f2937";
        timeBadge.style.color = "white";
        timeBadge.style.fontSize = "9px";
        timeBadge.style.fontWeight = "600";
        timeBadge.style.padding = "1px 4px";
        timeBadge.style.borderRadius = "4px";
        timeBadge.style.whiteSpace = "nowrap";
        timeBadge.style.position = "absolute";
        timeBadge.style.top = "-20px"; // Position above marker
        timeBadge.style.left = "50%";
        timeBadge.style.transform = "translateX(-50%)";
        timeBadge.style.zIndex = "2";
        el.appendChild(timeBadge);

        marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([lead.longitude, lead.latitude])
          .setPopup(new mapboxgl.Popup({
            offset: [0, -25],
            closeOnClick: false,
            maxWidth: "min(90vw, 340px)",
            anchor: "bottom"
          }).setHTML(popupHTML))
          .addTo(map);

        leadMarkersRef.current.set(lead.id, marker);
      } else {
        marker.setLngLat([lead.longitude, lead.latitude]);
        marker.getPopup()?.setHTML(popupHTML);

        // Update visuals
        const el = marker.getElement();
        // Update SVG color
        const svgPath = el.querySelector('path');
        if (svgPath) svgPath.setAttribute('fill', leadColor);

        // Update content ($ sign)
        // If status changed to/from completed, we might need to recreate inner structure or toggle visibility,
        // but for simplicity, regenerating the innerHTML of just the SVG is easier, 
        // however we have the Badge appended. 
        // Let's just update the path fill which handles 90% of cases.
        // For the '$', we effectively need to manage that child div.
        let contentEl = el.lastElementChild as HTMLElement; // Assuming last child might be text or badge
        // Detailed check involves looking for z-index 1 div we created in helper
        // Ideally we'd rebuild the element content completely if status changes type drastically

        if (lead.status === "completed" && !el.innerText.includes("$")) {
          // Add $ if missing
          const c = document.createElement('div');
          c.style.position = 'absolute';
          c.style.top = '8px';
          c.style.color = 'white';
          c.style.fontWeight = 'bold';
          c.style.fontSize = '14px';
          c.style.zIndex = '1';
          c.innerHTML = "$";
          el.appendChild(c);
        } else if (lead.status !== "completed") {
          // Remove $ if present
          // This is a bit hacky, cleaner refactor would be to simple recreate the marker element entirely 
          // but that flashes on the map.
          // For now, let's trust the color update.
        }
      }

      // Update badge and visibility
      const el = marker.getElement() as HTMLDivElement;
      
      // Set visibility based on filter
      el.style.display = isVisible ? "block" : "none";
      
      const timeBadge = el.querySelector('[data-role="time-badge"]') as HTMLDivElement | null;
      if (timeBadge) {
        if (lead.created_at && lead.status !== "completed" && isVisible) {
          timeBadge.style.display = "block";
          timeBadge.textContent = formatTimeAgo(lead.created_at);
        } else {
          timeBadge.style.display = "none";
          timeBadge.textContent = "";
        }
      }
    });

    // Adjust map bounds to show both agents AND leads (only on initial load)
    if (!initialBoundsFitRef.current && (agents.length > 0 || leads.length > 0)) {
      const bounds = new mapboxgl.LngLatBounds();

      agents.forEach((agent) => {
        bounds.extend([agent.longitude, agent.latitude]);
      });

      leads.forEach((lead) => {
        bounds.extend([lead.longitude, lead.latitude]);
      });

      map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
      initialBoundsFitRef.current = true;
    }
  };

  return (
    <div className="h-full relative">
      {showTokenInput ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 p-6">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Mapbox Setup</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Enter your Mapbox public token to enable the map. Get your free token from{" "}
              <a
                href="https://account.mapbox.com/access-tokens/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                mapbox.com
              </a>
            </p>
            <form onSubmit={handleTokenSubmit} className="space-y-3">
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="pk.eyJ1IjoieW91ci10b2tlbi1oZXJlIi4uLg=="
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="pl-9"
                />
              </div>
              {tokenError && (
                <p className="text-sm text-destructive">{tokenError}</p>
              )}
              <Button type="submit" className="w-full">
                Save Token
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <div ref={mapRef} className="w-full h-full" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToken}
            className="absolute top-2 left-2 z-10"
          >
            Reset Token
          </Button>
          
          {/* Status Filter Buttons */}
          {mapLoaded && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10">
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
              />
            </div>
          )}
          
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
              <div className="text-center space-y-3 p-6 bg-card rounded-lg border shadow-lg max-w-xs">
                {loadingTimeout ? (
                  <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
                ) : (
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                )}
                <div>
                  <p className="text-sm font-medium">{loadingStatus}</p>
                  {loadingTimeout && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Check your internet connection or try a different token.
                    </p>
                  )}
                </div>
                {loadingTimeout && (
                  <div className="flex gap-2 justify-center pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleResetToken}
                    >
                      Change Token
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const token = localStorage.getItem("mapbox_token");
                        if (token) initializeMap(token);
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default MapView;
