import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const AnalyticsHeatMap = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [mapFailed, setMapFailed] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ["heatmap-locations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leads")
        .select("latitude, longitude")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(1000);
      return data || [];
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getMapboxToken } = await import("@/lib/mapboxToken");
      const t = await getMapboxToken();
      if (!cancelled && t) setMapboxToken(t);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapboxToken || !mapContainer.current || locations.length === 0) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [28.0473, -26.2041], // Johannesburg default
      zoom: 8,
    });

    mapRef.current = map;

    map.on("load", () => {
      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: locations.map((l) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [Number(l.longitude), Number(l.latitude)] },
          properties: {},
        })),
      };

      map.addSource("jobs-heat", { type: "geojson", data: geojson });

      map.addLayer({
        id: "jobs-heatmap",
        type: "heatmap",
        source: "jobs-heat",
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 9, 20],
          "heatmap-opacity": 0.7,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "hsl(204, 100%, 70%)",
            0.4, "hsl(142, 76%, 50%)",
            0.6, "hsl(38, 92%, 50%)",
            0.8, "hsl(25, 95%, 53%)",
            1, "hsl(0, 84%, 60%)",
          ],
        },
      });

      // Fit to bounds
      if (locations.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        locations.forEach((l) => bounds.extend([Number(l.longitude), Number(l.latitude)]));
        map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
      }
    });

    map.on("error", () => {
      setMapFailed(true);
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
    };
  }, [mapboxToken, locations]);

  if (!mapboxToken) {
    return (
      <div className="h-80 rounded-xl bg-muted flex items-center justify-center text-muted-foreground text-sm">
        Configure Mapbox token in Settings to view heat map
      </div>
    );
  }

  if (mapFailed) {
    return (
      <div className="h-80 rounded-xl bg-muted flex flex-col items-center justify-center gap-2">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground font-medium">Map unavailable</p>
        <Button size="sm" variant="outline" onClick={() => { setMapFailed(false); setMapboxToken(""); }}>
          Retry
        </Button>
      </div>
    );
  }

  return <div ref={mapContainer} className="h-80 rounded-xl overflow-hidden" />;
};

export default AnalyticsHeatMap;
