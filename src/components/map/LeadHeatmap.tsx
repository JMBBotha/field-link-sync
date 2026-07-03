import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Flame } from "lucide-react";
import { subDays, startOfMonth } from "date-fns";

type TimePreset = "7d" | "30d" | "90d" | "this_month" | "all";

interface HeatmapLead {
  latitude: number;
  longitude: number;
  status: string;
}

const TIME_PRESETS: { label: string; value: TimePreset }[] = [
  { label: "Last 7d", value: "7d" },
  { label: "Last 30d", value: "30d" },
  { label: "Last 90d", value: "90d" },
  { label: "This Month", value: "this_month" },
  { label: "All Time", value: "all" },
];

const LeadHeatmap = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noToken, setNoToken] = useState(false);

  const [showActive, setShowActive] = useState(true);
  const [showCompleted, setShowCompleted] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [timePreset, setTimePreset] = useState<TimePreset>("30d");

  const [leads, setLeads] = useState<HeatmapLead[]>([]);

  // Fetch leads based on time filter
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("leads").select("latitude, longitude, status, created_at");

    if (timePreset !== "all") {
      let from: Date;
      if (timePreset === "this_month") {
        from = startOfMonth(new Date());
      } else {
        const days = timePreset === "7d" ? 7 : timePreset === "30d" ? 30 : 90;
        from = subDays(new Date(), days);
      }
      query = query.gte("created_at", from.toISOString());
    }

    const { data } = await query;
    setLeads((data || []) as HeatmapLead[]);
    setLoading(false);
  }, [timePreset]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Init map
  useEffect(() => {
    let cancelled = false;
    let map: mapboxgl.Map | null = null;
    (async () => {
      const { getMapboxToken, getMapboxTokenSync } = await import("@/lib/mapboxToken");
      const token = getMapboxTokenSync() || (await getMapboxToken());
      if (cancelled) return;
      if (!token || !token.startsWith("pk.")) {
        setNoToken(true);
        setLoading(false);
        return;
      }
      if (!mapContainerRef.current) return;

      mapboxgl.accessToken = token;
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [24.0, -30.0],
        zoom: 5,
      });

      map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

      map.on("load", () => {
        mapRef.current = map;
        setMapLoaded(true);
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [noToken]);

  // Update heatmap sources when leads or toggles change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const layers: { id: string; enabled: boolean; statuses: string[]; color: string }[] = [
      {
        id: "heatmap-active",
        enabled: showActive,
        statuses: ["accepted", "in_progress"],
        color: "#22c55e",
      },
      {
        id: "heatmap-completed",
        enabled: showCompleted,
        statuses: ["completed"],
        color: "#3b82f6",
      },
      {
        id: "heatmap-pending",
        enabled: showPending,
        statuses: ["pending"],
        color: "#ef4444",
      },
    ];

    for (const layer of layers) {
      // Remove existing
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      if (map.getSource(layer.id)) map.removeSource(layer.id);

      if (!layer.enabled) continue;

      const features = leads
        .filter((l) => layer.statuses.includes(l.status))
        .map((l) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [l.longitude, l.latitude] },
          properties: {},
        }));

      if (features.length === 0) continue;

      map.addSource(layer.id, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });

      map.addLayer({
        id: layer.id,
        type: "heatmap",
        source: layer.id,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            0, 1,
            9, 3,
          ],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, layer.id === "heatmap-active"
              ? "rgba(34,197,94,0.3)"
              : layer.id === "heatmap-completed"
                ? "rgba(59,130,246,0.3)"
                : "rgba(239,68,68,0.3)",
            0.4, layer.id === "heatmap-active"
              ? "rgba(34,197,94,0.5)"
              : layer.id === "heatmap-completed"
                ? "rgba(59,130,246,0.5)"
                : "rgba(239,68,68,0.5)",
            0.6, layer.id === "heatmap-active"
              ? "rgba(34,197,94,0.7)"
              : layer.id === "heatmap-completed"
                ? "rgba(59,130,246,0.7)"
                : "rgba(239,68,68,0.7)",
            0.8, layer.id === "heatmap-active"
              ? "rgba(22,163,74,0.85)"
              : layer.id === "heatmap-completed"
                ? "rgba(37,99,235,0.85)"
                : "rgba(220,38,38,0.85)",
            1, layer.color,
          ],
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            0, 2,
            5, 15,
            9, 30,
            14, 50,
          ],
          "heatmap-opacity": 0.8,
        },
      });
    }
  }, [leads, showActive, showCompleted, showPending, mapLoaded]);

  // Fit bounds to leads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || leads.length === 0) return;

    const validLeads = leads.filter(
      (l) => l.latitude && l.longitude && !isNaN(l.latitude) && !isNaN(l.longitude)
    );
    if (validLeads.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    validLeads.forEach((l) => bounds.extend([l.longitude, l.latitude]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 800 });
  }, [leads, mapLoaded]);

  if (noToken) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">
          Set up your Mapbox token on the Map tab first.
        </p>
      </div>
    );
  }

  const activeCount = leads.filter((l) => ["accepted", "in_progress"].includes(l.status)).length;
  const completedCount = leads.filter((l) => l.status === "completed").length;
  const pendingCount = leads.filter((l) => l.status === "pending").length;

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Controls overlay */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        {/* Layer toggles */}
        <div className="rounded-lg border bg-card/95 backdrop-blur-md shadow-lg p-3 space-y-3 max-w-[220px]">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Flame className="h-4 w-4 text-orange-500" />
            Heatmap Layers
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5 cursor-pointer">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" />
                Active ({activeCount})
              </Label>
              <Switch checked={showActive} onCheckedChange={setShowActive} className="scale-75" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5 cursor-pointer">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 inline-block" />
                Completed ({completedCount})
              </Label>
              <Switch checked={showCompleted} onCheckedChange={setShowCompleted} className="scale-75" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5 cursor-pointer">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
                Pending ({pendingCount})
              </Label>
              <Switch checked={showPending} onCheckedChange={setShowPending} className="scale-75" />
            </div>
          </div>
        </div>

        {/* Time presets */}
        <div className="rounded-lg border bg-card/95 backdrop-blur-md shadow-lg p-2 flex flex-wrap gap-1 max-w-[220px]">
          {TIME_PRESETS.map((preset) => (
            <Button
              key={preset.value}
              size="sm"
              variant={timePreset === preset.value ? "default" : "outline"}
              onClick={() => setTimePreset(preset.value)}
              className="text-[11px] h-7 px-2"
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-20">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading heatmap data…
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadHeatmap;
