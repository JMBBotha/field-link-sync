import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, Crosshair, Loader2, Maximize2, Minimize2, Search, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMapboxToken, getMapboxTokenSync } from "@/lib/mapboxToken";

const DEFAULT_CENTER: [number, number] = [18.4241, -33.9249]; // [lng, lat] Cape Town

export type LocationChangeSource = "map" | "drag" | "gps" | "search";

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (
    lat: number,
    lng: number,
    address?: string,
    source?: LocationChangeSource,
  ) => void;
  /** Optional address text shown in the empty state when no pin exists yet. */
  addressHint?: string | null;
}


interface Suggestion {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
}

const getStoredToken = () =>
  (typeof window !== "undefined" && localStorage.getItem("mapbox_token")) || "";

const LocationPicker = ({ latitude, longitude, onLocationChange, addressHint }: LocationPickerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  const [token, setToken] = useState<string>(getMapboxTokenSync());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ lat: number; lng: number } | null>(null);

  // Fetch shared token if not already cached
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    getMapboxToken().then((t) => {
      if (!cancelled && t) setToken(t);
    });
    return () => { cancelled = true; };
  }, [token]);

  // Initialize / re-init map
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;
    try {
      mapboxgl.accessToken = token;
      const initial: [number, number] =
        latitude != null && longitude != null ? [longitude, latitude] : DEFAULT_CENTER;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: initial,
        zoom: latitude != null && longitude != null ? 15 : 11,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => setMapLoaded(true));
      map.on("error", (e) => {
        const msg = (e as any)?.error?.message || "Failed to load map";
        setMapError(msg);
      });
      map.on("click", (e) => {
        const { lat, lng } = e.lngLat;
        placeMarker(lat, lng, true);
      });
      mapRef.current = map;
    } catch (err: any) {
      setMapError(err?.message || "Failed to initialize map");
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Sync marker when props change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (latitude != null && longitude != null) {
      placeMarker(latitude, longitude, false);
      mapRef.current.flyTo({ center: [longitude, latitude], zoom: 15, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, latitude, longitude]);

  // Resize map on fullscreen toggle
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 250);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  // ESC closes fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Click outside suggestions
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const reverseGeocode = useCallback(
    async (lat: number, lng: number): Promise<string | undefined> => {
      if (!token) return;
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        return data?.features?.[0]?.place_name;
      } catch {
        return;
      }
    },
    [token],
  );

  const placeMarker = useCallback(
    (lat: number, lng: number, emit: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const m = new mapboxgl.Marker({ color: "#0077B6", draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);
        m.on("drag", () => {
          const ll = m.getLngLat();
          setDragPreview({ lat: ll.lat, lng: ll.lng });
        });
        m.on("dragend", async () => {
          const ll = m.getLngLat();
          setDragPreview(null);
          const address = await reverseGeocode(ll.lat, ll.lng);
          onLocationChange(ll.lat, ll.lng, address, "drag");
        });
        markerRef.current = m;
      }
      if (emit) {
        reverseGeocode(lat, lng).then((address) => onLocationChange(lat, lng, address, "map"));
      }
    },
    [onLocationChange, reverseGeocode],
  );

  // Debounced search for businesses + addresses
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const term = query.trim();
    if (!token || term.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({
          access_token: token,
          autocomplete: "true",
          limit: "8",
          types: "poi,address,place",
          language: "en",
        });
        const center = mapRef.current?.getCenter();
        if (center) params.set("proximity", `${center.lng},${center.lat}`);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(term)}.json?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSuggestions(data.features || []);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, token]);

  const handlePickSuggestion = (s: Suggestion) => {
    const [lng, lat] = s.center;
    placeMarker(lat, lng, false);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 800 });
    onLocationChange(lat, lng, s.place_name, "search");
    setQuery(s.text);
    setShowSuggestions(false);
  };

  const handleGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        placeMarker(lat, lng, false);
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 800 });
        const address = await reverseGeocode(lat, lng);
        onLocationChange(lat, lng, address, "gps");
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  if (!token) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span>Loading map…</span>
        </div>
      </div>
    );
  }

  const containerClasses = isFullscreen
    ? "fixed inset-0 z-[100] bg-background flex flex-col"
    : "relative w-full h-[280px] rounded-md border overflow-hidden";

  return (
    <div ref={wrapperRef} className={containerClasses}>
      {/* Top control bar */}
      <div className="absolute top-2 left-2 right-2 z-10 flex gap-2 items-start">
        <div ref={searchWrapRef} className="relative flex-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length && setShowSuggestions(true)}
              placeholder="Search business or address…"
              className="h-9 pl-7 pr-8 text-xs bg-background/95 backdrop-blur"
            />
            {searchLoading ? (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : query ? (
              <button
                type="button"
                onClick={() => { setQuery(""); setSuggestions([]); setShowSuggestions(false); }}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-72 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handlePickSuggestion(s)}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex gap-2 items-start border-b last:border-b-0"
                >
                  <MapPin className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{s.text}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{s.place_name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9 shrink-0 bg-background/95 backdrop-blur"
          onClick={handleGps}
          title="Use current location"
        >
          {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-9 w-9 shrink-0 bg-background/95 backdrop-blur"
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      {/* Drag preview */}
      {dragPreview && (
        <div className="absolute bottom-2 left-2 z-10 rounded-md bg-background/95 backdrop-blur px-2 py-1 text-[11px] font-mono shadow">
          {dragPreview.lat.toFixed(5)}, {dragPreview.lng.toFixed(5)}
        </div>
      )}

      {/* Map */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Pin guidance */}
      {latitude == null || longitude == null ? (
        <div className="absolute bottom-2 left-2 right-2 z-10 rounded-md bg-background/95 backdrop-blur px-3 py-2 text-[11px] shadow pointer-events-none">
          <div className="font-medium">No pin yet — search or tap the map to drop a pin.</div>
          {addressHint ? (
            <div className="text-muted-foreground truncate">{addressHint}</div>
          ) : null}
        </div>
      ) : !dragPreview ? (
        <div className="absolute bottom-2 left-2 z-10 rounded-md bg-background/90 backdrop-blur px-2 py-1 text-[11px] shadow pointer-events-none">
          Pin looks wrong? Drag it, tap the map, or search.
        </div>
      ) : null}

      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4">
          <div className="text-center space-y-2 max-w-sm">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
            <div className="text-sm font-medium">Map failed to load</div>
            <div className="text-xs text-muted-foreground">{mapError}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMapError(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationPicker;
