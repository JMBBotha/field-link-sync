import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AlertCircle, Check, Crosshair, Loader2, Maximize2, Search, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMapboxToken, getMapboxTokenSync } from "@/lib/mapboxToken";
import { supabase } from "@/integrations/supabase/client";
import { searchPlaces, parseCoordinates, type PlaceSuggestion } from "@/lib/placeSearch";

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


type Suggestion = PlaceSuggestion;

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
  // Warning shown instead of silently trusting a pin: vague area match or a pin in water.
  const [pinWarning, setPinWarning] = useState<string | null>(null);
  const historyPushedRef = useRef(false);
  // Set when a picked suggestion writes its name into the box: don't search it again.
  const skipSearchRef = useRef(false);

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

  // Pin-first: with no pin yet, centre on GPS, else the company's latest pinned lead, else Cape Town
  useEffect(() => {
    if (!mapLoaded || latitude != null || longitude != null) return;
    let gps = false;
    const centre = (lat: number, lng: number, zoom: number, fromGps: boolean) => {
      if (markerRef.current || !mapRef.current || (gps && !fromGps)) return;
      if (fromGps) gps = true;
      mapRef.current.jumpTo({ center: [lng, lat], zoom });
    };
    void supabase.from("leads").select("latitude, longitude").not("latitude", "is", null).neq("latitude", 0)
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => { const r: any = data?.[0]; if (r) centre(Number(r.latitude), Number(r.longitude), 12, false); });
    navigator.geolocation?.getCurrentPosition(
      (p) => centre(p.coords.latitude, p.coords.longitude, 15, true),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  // Resize map on fullscreen toggle
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 250);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  // True full-screen overlay. The picker lives inside dialogs/sheets whose
  // transform, scroll box and z-index (z-50, below the mobile bottom nav) trap a
  // `position: fixed` child: on iPhone the map covered only part of the screen,
  // the form showed under it and the exit button was out of reach. While
  // fullscreen we neutralise those styles on every ancestor and lift the
  // enclosing dialog above everything, then restore them exactly on exit. The
  // parent form never unmounts, so all typed data stays.
  useEffect(() => {
    if (!isFullscreen) return;
    const restore: Array<() => void> = [];
    let el = wrapperRef.current?.parentElement || null;
    while (el && el !== document.body && el !== document.documentElement) {
      const node = el;
      const cs = getComputedStyle(node);
      const prev = {
        transform: node.style.transform, animation: node.style.animation, filter: node.style.filter,
        overflow: node.style.overflow, contain: node.style.contain, willChange: node.style.willChange,
        zIndex: node.style.zIndex, maxHeight: node.style.maxHeight, backdropFilter: (node.style as any).backdropFilter,
        scrollTop: node.scrollTop,
      };
      if (cs.transform !== "none") node.style.transform = "none";
      if (cs.animationName !== "none") node.style.animation = "none";
      if (cs.filter !== "none") node.style.filter = "none";
      if ((cs as any).backdropFilter && (cs as any).backdropFilter !== "none") (node.style as any).backdropFilter = "none";
      if (cs.contain !== "none") node.style.contain = "none";
      if (cs.willChange !== "auto") node.style.willChange = "auto";
      if (cs.overflow !== "visible") { node.style.overflow = "hidden"; node.scrollTop = 0; }
      if (cs.position !== "static" && cs.zIndex !== "auto") node.style.zIndex = "2147483000";
      restore.push(() => {
        node.style.transform = prev.transform; node.style.animation = prev.animation;
        node.style.filter = prev.filter; (node.style as any).backdropFilter = prev.backdropFilter;
        node.style.contain = prev.contain; node.style.willChange = prev.willChange;
        node.style.overflow = prev.overflow; node.style.zIndex = prev.zIndex; node.style.maxHeight = prev.maxHeight;
        node.scrollTop = prev.scrollTop;
      });
      el = el.parentElement;
    }
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      restore.reverse().forEach((f) => f());
      document.body.style.overflow = prevBody;
    };
  }, [isFullscreen]);

  // Back gesture / history pop closes the fullscreen map (not the form).
  const openFullscreen = useCallback(() => {
    setIsFullscreen(true);
    try {
      window.history.pushState({ ...(window.history.state || {}), flMapFullscreen: true }, "");
      historyPushedRef.current = true;
    } catch { historyPushedRef.current = false; }
  }, []);
  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      if (window.history.state?.flMapFullscreen) window.history.back();
    }
  }, []);
  useEffect(() => {
    if (!isFullscreen) return;
    const onPop = () => {
      historyPushedRef.current = false;
      setIsFullscreen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isFullscreen]);
  // Unmounting while fullscreen (form closed) drops our extra history entry.
  useEffect(() => () => {
    if (historyPushedRef.current && window.history.state?.flMapFullscreen) window.history.back();
  }, []);

  // ESC closes fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeFullscreen(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isFullscreen, closeFullscreen]);

  // Never trust a pin in the sea: check the map's water layer under the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || latitude == null || longitude == null) return;
    const check = () => {
      try {
        const pt = map.project([longitude, latitude]);
        const hits = map.queryRenderedFeatures(pt).filter((f: any) => f.sourceLayer === "water");
        if (hits.length) setPinWarning("This pin is in the water. Drag it onto the property or tap the right spot.");
        else setPinWarning((w) => (w && w.includes("water") ? null : w));
      } catch { /* style not ready */ }
    };
    const t = window.setTimeout(() => { if (map.loaded()) check(); else map.once("idle", check); }, 900);
    return () => window.clearTimeout(t);
  }, [mapLoaded, latitude, longitude]);

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
          setPinWarning(null);
          const address = await reverseGeocode(ll.lat, ll.lng);
          onLocationChange(ll.lat, ll.lng, address, "drag");
        });
        markerRef.current = m;
      }
      if (emit) {
        setPinWarning(null);
        reverseGeocode(lat, lng).then((address) => onLocationChange(lat, lng, address, "map"));
      }
    },
    [onLocationChange, reverseGeocode],
  );

  // Debounced search: pasted coordinates / Google Maps link, then Mapbox (ZA,
  // all place types, fuzzy), then OpenStreetMap for farms and rural roads.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const term = query.trim();
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    debounceRef.current = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const c = mapRef.current?.getCenter();
        const list = await searchPlaces(term, token, c ? [c.lng, c.lat] : undefined);
        if (cancelled) return;
        setSuggestions(list);
        setShowSuggestions(true);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, token]);

  const handlePickSuggestion = async (s: Suggestion) => {
    const [lng, lat] = s.center;
    if (s.text !== query) {
      skipSearchRef.current = true;
      setQuery(s.text);
    }
    setShowSuggestions(false);
    if (s.approximate) {
      // A town/suburb centre is not the property: centre the map, no silent pin.
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });
      setPinWarning(`"${s.text}" is an area, not an exact spot. Tap the property on the map to drop the pin.`);
      return;
    }
    setPinWarning(null);
    placeMarker(lat, lng, false);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 800 });
    const coordsOnly = s.id.startsWith("coords:");
    const address = coordsOnly ? await reverseGeocode(lat, lng) : s.place_name;
    onLocationChange(lat, lng, address, "search");
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
    ? "fixed inset-0 !m-0 z-[2147483000] bg-background h-[100dvh] w-screen isolate"
    : "relative w-full h-[280px] rounded-md border overflow-hidden";
  const fsTop = "env(safe-area-inset-top, 0px)";
  const fsBottom = "env(safe-area-inset-bottom, 0px)";

  return (
    <div
      ref={wrapperRef}
      className={containerClasses}
      style={isFullscreen ? { pointerEvents: "auto" } : undefined}
      data-map-fullscreen={isFullscreen ? "true" : undefined}
    >
      {/* Fullscreen header: always below the iPhone status bar / notch */}
      {isFullscreen && (
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b bg-background/95 backdrop-blur px-3 pb-2"
          style={{ paddingTop: `calc(${fsTop} + 0.5rem)` }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-3"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeFullscreen(); }}
            title="Close map"
            aria-label="Close map"
          >
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
          <div className="flex-1 text-center text-sm font-semibold">Set the pin</div>
          <Button
            type="button"
            size="sm"
            className="h-9 px-3"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeFullscreen(); }}
            title="Done"
          >
            Done
          </Button>
        </div>
      )}
      {/* Top control bar */}
      <div
        className="absolute left-2 right-2 z-10 flex gap-2 items-start"
        style={{ top: isFullscreen ? `calc(${fsTop} + 3.75rem)` : "0.5rem" }}
      >
        <div ref={searchWrapRef} className="relative flex-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length && setShowSuggestions(true)}
              placeholder="Search place, farm, road or paste a map link…"
              enterKeyHint="search"
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
          {showSuggestions && !searchLoading && query.trim().length >= 3 && suggestions.length === 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
              Not found on our map. Tap the map to drop the pin, paste a Google Maps link or coordinates, and type the address in the Address box.
            </div>
          )}
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
                    <div className="text-xs text-muted-foreground truncate">{s.place_name}</div>
                    {s.source === "osm" ? (
                      <div className="text-[10px] text-muted-foreground">OpenStreetMap</div>
                    ) : null}
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
        {!isFullscreen && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-9 w-9 shrink-0 bg-background/95 backdrop-blur"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openFullscreen(); }}
            title="Fullscreen"
            aria-label="Open fullscreen map"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Drag preview */}
      {dragPreview && (
        <div
          className="absolute left-2 z-10 rounded-md bg-background/95 backdrop-blur px-2 py-1 text-xs font-mono shadow"
          style={{ bottom: isFullscreen ? `calc(${fsBottom} + 4.5rem)` : "0.5rem" }}
        >
          {dragPreview.lat.toFixed(5)}, {dragPreview.lng.toFixed(5)}
        </div>
      )}

      {/* Map */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Pin guidance / warnings */}
      <div
        className="absolute left-2 right-2 z-10 flex flex-col gap-2 pointer-events-none"
        style={{ bottom: isFullscreen ? `calc(${fsBottom} + 0.75rem)` : "0.5rem" }}
      >
        {pinWarning ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs shadow">
            <div className="flex gap-2 items-start">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{pinWarning}</span>
            </div>
          </div>
        ) : null}
        {latitude == null || longitude == null ? (
          <div className="rounded-md bg-background/95 backdrop-blur px-3 py-2 text-xs shadow">
            <div className="font-medium">No pin yet — search or tap the map to drop a pin.</div>
            {addressHint ? (
              <div className="text-muted-foreground truncate">{addressHint}</div>
            ) : null}
          </div>
        ) : !dragPreview && !isFullscreen ? (
          <div className="self-start rounded-md bg-background/90 backdrop-blur px-2 py-1 text-xs shadow">
            Pin looks wrong? Drag it, tap the map, or search.
          </div>
        ) : null}
        {isFullscreen ? (
          <Button
            type="button"
            className="pointer-events-auto h-11 w-full shadow-lg"
            disabled={latitude == null || longitude == null}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeFullscreen(); }}
          >
            <Check className="h-4 w-4 mr-2" />
            {latitude == null || longitude == null ? "Tap the map to drop a pin" : "Use this pin"}
          </Button>
        ) : null}
      </div>

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
