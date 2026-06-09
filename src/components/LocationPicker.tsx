import { useEffect, useRef, useState, useCallback } from "react";
import {
  APIProvider,
  Map,
  useMap,
  useMapsLibrary,
  AdvancedMarker,
} from "@vis.gl/react-google-maps";
import { AlertCircle, Crosshair, Loader2, Maximize2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const GOOGLE_MAPS_API_KEY = "AIzaSyBeInqqEhzsu_U7OImGQnvJ8vusF_21wvc";
const DEFAULT_CENTER = { lat: -33.9249, lng: 18.4241 };
const MAP_ID = "location_picker_map";

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number, lng: number, address?: string) => void;
}

interface MapInteractiveProps extends LocationPickerProps {
  onMapReady: () => void;
  onDragPreview: (pos: google.maps.LatLngLiteral | null) => void;
}

const MapInteractive = ({
  latitude,
  longitude,
  onLocationChange,
  onMapReady,
  onDragPreview,
}: MapInteractiveProps) => {
  const map = useMap();
  const geocodingLibrary = useMapsLibrary("geocoding");
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const [markerPosition, setMarkerPosition] = useState<google.maps.LatLngLiteral | null>(
    latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null,
  );

  useEffect(() => {
    if (geocodingLibrary) geocoderRef.current = new geocodingLibrary.Geocoder();
  }, [geocodingLibrary]);

  useEffect(() => {
    if (map) onMapReady();
  }, [map, onMapReady]);

  useEffect(() => {
    if (map && latitude != null && longitude != null) {
      const position = { lat: latitude, lng: longitude };
      setMarkerPosition(position);
      map.panTo(position);
    }
  }, [map, latitude, longitude]);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng;
      if (!latLng) return;
      const lat = latLng.lat();
      const lng = latLng.lng();
      setMarkerPosition({ lat, lng });
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            onLocationChange(lat, lng, results[0].formatted_address);
          } else {
            onLocationChange(lat, lng);
          }
        });
      } else {
        onLocationChange(lat, lng);
      }
    },
    [onLocationChange],
  );

  const handleMarkerDrag = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng;
      if (!latLng) return;
      const pos = { lat: latLng.lat(), lng: latLng.lng() };
      setMarkerPosition(pos);
      onDragPreview(pos);
    },
    [onDragPreview],
  );

  const handleMarkerDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const latLng = e.latLng;
      if (!latLng) return;
      const lat = latLng.lat();
      const lng = latLng.lng();
      setMarkerPosition({ lat, lng });
      onDragPreview(null);
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            onLocationChange(lat, lng, results[0].formatted_address);
          } else {
            onLocationChange(lat, lng);
          }
        });
      } else {
        onLocationChange(lat, lng);
      }
    },
    [onLocationChange, onDragPreview],
  );

  useEffect(() => {
    if (!map) return;
    clickListenerRef.current = map.addListener("click", handleMapClick);
    return () => {
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
    };
  }, [map, handleMapClick]);

  return markerPosition ? (
    <AdvancedMarker
      position={markerPosition}
      draggable
      onDrag={handleMarkerDrag}
      onDragEnd={handleMarkerDragEnd}
      title="Drag to adjust location"
    />
  ) : null;
};

const LocationPickerInner = ({ latitude, longitude, onLocationChange }: LocationPickerProps) => {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [mapError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<google.maps.LatLngLiteral | null>(null);

  const placesLibrary = useMapsLibrary("places");
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);

  useEffect(() => {
    if (placesLibrary && !autocompleteServiceRef.current) {
      autocompleteServiceRef.current = new placesLibrary.AutocompleteService();
      placesServiceRef.current = new placesLibrary.PlacesService(
        document.createElement("div"),
      );
    }
  }, [placesLibrary]);

  const handleMapReady = useCallback(() => setIsLoading(false), []);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setSearchError(null);
    if (!value.trim() || !autocompleteServiceRef.current) {
      setSuggestions([]);
      return;
    }
    autocompleteServiceRef.current.getPlacePredictions(
      { input: value, componentRestrictions: { country: "za" } },
      (preds, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && preds) {
          setSuggestions(preds);
        } else {
          setSuggestions([]);
          if (status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setSearchError("Search unavailable. Try clicking the map instead.");
          }
        }
      },
    );
  }, []);

  const handleSelectSuggestion = useCallback(
    (placeId: string) => {
      if (!placesServiceRef.current) return;
      placesServiceRef.current.getDetails(
        { placeId, fields: ["geometry", "formatted_address"] },
        (place, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            place?.geometry?.location
          ) {
            onLocationChange(
              place.geometry.location.lat(),
              place.geometry.location.lng(),
              place.formatted_address ?? undefined,
            );
            setSearch(place.formatted_address ?? "");
            setSuggestions([]);
          }
        },
      );
    },
    [onLocationChange],
  );

  const handleGPS = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onLocationChange(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        console.error(err);
        setSearchError("Unable to retrieve your location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [onLocationChange]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    if (isFullscreen) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  const center =
    latitude != null && longitude != null
      ? { lat: latitude, lng: longitude }
      : DEFAULT_CENTER;

  const searchBar = (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search address in South Africa"
            disabled={isLoading || !!mapError}
            className="pl-8 h-9 bg-background/95 backdrop-blur"
          />
          {suggestions.length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.place_id}
                  type="button"
                  onClick={() => handleSelectSuggestion(s.place_id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                >
                  {s.description}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleGPS}
          disabled={isLoading || !!mapError}
          className="h-9"
        >
          <Crosshair className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setIsFullscreen((v) => !v)}
          className="h-9"
        >
          {isFullscreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>
      {searchError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {searchError}
        </p>
      )}
    </div>
  );

  const mapBlock = (
    <div className="relative w-full h-full">
      {mapError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60 p-4 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm">{mapError}</p>
        </div>
      ) : (
        <>
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/40">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading map…</span>
            </div>
          )}
          <Map
            defaultCenter={center}
            defaultZoom={latitude != null && longitude != null ? 16 : 12}
            mapId={MAP_ID}
            mapTypeId="hybrid"
            gestureHandling="greedy"
            mapTypeControl
            streetViewControl={false}
            fullscreenControl={false}
            style={{ width: "100%", height: "100%" }}
          >
            <MapInteractive
              latitude={latitude}
              longitude={longitude}
              onLocationChange={onLocationChange}
              onMapReady={handleMapReady}
              onDragPreview={setDragPreview}
            />
            {dragPreview && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-background/90 backdrop-blur border text-xs font-mono shadow">
                {dragPreview.lat.toFixed(6)}, {dragPreview.lng.toFixed(6)}
              </div>
            )}
          </Map>
        </>
      )}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="p-3 border-b">{searchBar}</div>
        <div className="flex-1 relative">{mapBlock}</div>
        {latitude != null && longitude != null && (
          <div className="p-2 text-sm text-muted-foreground border-t bg-background/90">
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {searchBar}
      <div className="h-48 rounded-md border overflow-hidden">{mapBlock}</div>
      {latitude != null && longitude != null && (
        <p className="text-xs text-muted-foreground">
          Selected: {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </p>
      )}
    </div>
  );
};

export const LocationPicker = (props: LocationPickerProps) => (
  <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={["places", "geocoding", "marker"]}>
    <LocationPickerInner {...props} />
  </APIProvider>
);

export default LocationPicker;
