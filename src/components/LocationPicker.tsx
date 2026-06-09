import { useEffect, useRef, useState, useCallback } from "react";
import { APIProvider, Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Crosshair, Loader2, MapPin, Maximize2, Navigation, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any;

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number, lng: number, address?: string) => void;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const DEFAULT_CENTER = { lat: -33.9249, lng: 18.4241 };

/** Marker + click handling inside the Map */
const MapInteractive = ({
  latitude,
  longitude,
  onLocationChange,
}: LocationPickerProps) => {
  const map = useMap();
  const markerRef = useRef<any>(null);

  // Place / update marker
  const placeMarker = useCallback(
    (lat: number, lng: number, fireCallback = true, address?: string) => {
      if (!map) return;
      const position = { lat, lng };
      if (!markerRef.current) {
        markerRef.current = new google.maps.Marker({
          position,
          map,
          draggable: true,
        });
        markerRef.current.addListener("dragend", () => {
          const p = markerRef.current?.getPosition();
          if (p) onLocationChange(p.lat(), p.lng());
        });
      } else {
        markerRef.current.setPosition(position);
      }
      if (fireCallback) onLocationChange(lat, lng, address);
    },
    [map, onLocationChange],
  );

  // Initialize marker from props
  useEffect(() => {
    if (!map) return;
    if (latitude != null && longitude != null) {
      if (!markerRef.current) {
        placeMarker(latitude, longitude, false);
      } else {
        markerRef.current.setPosition({ lat: latitude, lng: longitude });
      }
    }
  }, [map, latitude, longitude, placeMarker]);

  // Click to place marker
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (e: any) => {
      if (!e.latLng) return;
      placeMarker(e.latLng.lat(), e.latLng.lng());
    });
    return () => listener.remove();
  }, [map, placeMarker]);

  return null;
};

/** Address search using Places Autocomplete */
const PlacesSearch = ({
  onPick,
  placeholder = "Search address...",
  inputRef,
}: {
  onPick: (lat: number, lng: number, address: string) => void;
  placeholder?: string;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
}) => {
  const placesLib = useMapsLibrary("places");
  const localRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? localRef;

  useEffect(() => {
    if (!placesLib || !ref.current) return;
    const ac = new placesLib.Autocomplete(ref.current, {
      fields: ["formatted_address", "geometry"],
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place.geometry?.location;
      if (!loc) return;
      onPick(loc.lat(), loc.lng(), place.formatted_address || "");
    });
    return () => listener.remove();
  }, [placesLib, onPick, ref]);

  return (
    <div className="relative w-full">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={ref}
        type="text"
        placeholder={placeholder}
        className="pl-8 h-9 bg-background/95 backdrop-blur shadow-sm"
      />
    </div>
  );
};

const LocationPicker = ({ latitude, longitude, onLocationChange }: LocationPickerProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fsSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Use a key to force fresh Map mount per scope (inline vs fullscreen)
  const center =
    latitude != null && longitude != null ? { lat: latitude, lng: longitude } : DEFAULT_CENTER;

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        // Reverse geocode via Google Geocoder if available
        let address: string | undefined;
        try {
          if (window.google?.maps) {
            const geocoder = new google.maps.Geocoder();
            const res = await geocoder.geocode({ location: { lat, lng } });
            address = res.results?.[0]?.formatted_address;
            if (address) {
              if (searchInputRef.current) searchInputRef.current.value = address;
              if (fsSearchInputRef.current) fsSearchInputRef.current.value = address;
            }
          }
        } catch (e) {
          console.error("Reverse geocoding failed:", e);
        }
        onLocationChange(lat, lng, address);
        setGettingLocation(false);
      },
      (error) => {
        setGettingLocation(false);
        let message = "Unable to get your location";
        if (error.code === error.PERMISSION_DENIED)
          message = "Location permission denied. Please enable location access.";
        else if (error.code === error.POSITION_UNAVAILABLE)
          message = "Location information unavailable.";
        else if (error.code === error.TIMEOUT) message = "Location request timed out.";
        alert(message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="h-48 rounded-md border border-dashed flex items-center justify-center bg-muted/50">
        <p className="text-sm text-muted-foreground text-center px-4">
          Google Maps API key not configured. Set VITE_GOOGLE_MAPS_API_KEY.
        </p>
      </div>
    );
  }

  const mapEl = (fullscreen: boolean) => (
    <Map
      defaultCenter={center}
      defaultZoom={latitude && longitude ? 16 : 12}
      mapTypeId="hybrid"
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapTypeControl
      streetViewControl={false}
      fullscreenControl={false}
      zoomControlOptions={
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.google?.maps ? { position: google.ControlPosition[fullscreen ? "RIGHT_BOTTOM" : "RIGHT_TOP"] } : undefined
      }
      style={{ width: "100%", height: "100%" }}
    >
      <MapInteractive
        latitude={latitude}
        longitude={longitude}
        onLocationChange={onLocationChange}
      />
    </Map>
  );

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={["places", "marker"]}>
      {isFullscreen ? (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="absolute top-4 left-4 right-20 z-10 max-w-md">
            <PlacesSearch
              inputRef={fsSearchInputRef}
              onPick={(lat, lng, address) => onLocationChange(lat, lng, address)}
            />
          </div>
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-3">
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-foreground bg-background/80 backdrop-blur px-2 py-0.5 rounded">
                Close
              </span>
              <Button
                type="button"
                size="icon"
                onClick={() => setIsFullscreen(false)}
                className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-foreground bg-background/80 backdrop-blur px-2 py-0.5 rounded">
                Locate
              </span>
              <Button
                type="button"
                size="icon"
                onClick={handleGetCurrentLocation}
                disabled={gettingLocation}
                className="h-12 w-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
              >
                {gettingLocation ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Navigation className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
          <div className="w-full h-full">{mapEl(true)}</div>
          {latitude && longitude && (
            <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur px-3 py-2 rounded-md shadow">
              <p className="text-sm">
                Selected: {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <PlacesSearch
                inputRef={searchInputRef}
                onPick={(lat, lng, address) => onLocationChange(lat, lng, address)}
              />
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGetCurrentLocation}
                disabled={gettingLocation}
                className="h-9 px-2"
              >
                {gettingLocation ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4" />
                )}
                <span className="ml-1 text-xs">GPS</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(true)}
                className="h-9 px-2"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="h-48 rounded-md border overflow-hidden">{mapEl(false)}</div>
          {latitude && longitude && (
            <p className="text-xs text-muted-foreground">
              Selected: {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </p>
          )}
        </div>
      )}
    </APIProvider>
  );
};

export default LocationPicker;
