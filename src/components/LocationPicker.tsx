import { useEffect, useState, useCallback, useRef } from "react";
import {
  APIProvider,
  APILoadingStatus,
  Map,
  useApiLoadingStatus,
  useMapsLibrary,
  AdvancedMarker,
} from "@vis.gl/react-google-maps";
import { AlertCircle, Crosshair, Loader2, Maximize2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const GOOGLE_MAPS_API_KEY = "AIzaSyBeInqqEhzsu_U7OImGQnvJ8vusF_21wvc";
const DEFAULT_CENTER = { lat: -33.9249, lng: 18.4241 };

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number, lng: number, address?: string) => void;
}

const LocationPicker = (props: LocationPickerProps) => (
  <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={["places", "geocoding", "marker"]}>
    <LocationPickerInner {...props} />
  </APIProvider>
);

interface Prediction {
  place_id: string;
  description: string;
}

const LocationPickerInner = ({
  latitude,
  longitude,
  onLocationChange,
}: LocationPickerProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const apiStatus = useApiLoadingStatus();
  const placesLib = useMapsLibrary("places");
  const geocoderLib = useMapsLibrary("geocoding");

  const geocoder = useRef<google.maps.Geocoder | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autocompleteService = useRef<any>(null);

  useEffect(() => {
    if (geocoderLib) geocoder.current = new geocoderLib.Geocoder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (placesLib) autocompleteService.current = new (placesLib as any).AutocompleteService();
  }, [geocoderLib, placesLib]);

  const apiLoading = apiStatus === APILoadingStatus.LOADING || apiStatus === APILoadingStatus.NOT_LOADED;
  const apiFailed =
    apiStatus === APILoadingStatus.FAILED || apiStatus === APILoadingStatus.AUTH_FAILURE;
  const apiReady = apiStatus === APILoadingStatus.LOADED;
  const placesReady = apiReady && !!autocompleteService.current;

  const reverseGeocode = useCallback(
    (lat: number, lng: number) => {
      if (!geocoder.current) {
        onLocationChange(lat, lng);
        return;
      }
      geocoder.current.geocode({ location: { lat, lng } }, (results, status) => {
        const address =
          status === "OK" && results && results[0] ? results[0].formatted_address : undefined;
        onLocationChange(lat, lng, address);
        if (address) setSelectedAddress(address);
      });
    },
    [onLocationChange],
  );

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    if (!autocompleteService.current) {
      setSearchError("Places service not ready yet");
      return;
    }
    setSearchError(null);
    setIsSearching(true);
    autocompleteService.current.getPlacePredictions(
      { input: searchQuery, componentRestrictions: { country: "za" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[] | null, status: string) => {
        setIsSearching(false);
        if (status === "OK" && results) {
          setPredictions(
            results.map((r) => ({ place_id: r.place_id, description: r.description })),
          );
        } else {
          setPredictions([]);
          if (status !== "ZERO_RESULTS") {
            setSearchError(`Places search failed (${status}). Check the API is enabled.`);
          }
        }
      },
    );
  }, [searchQuery]);

  const handleSelectPlace = useCallback(
    (placeId: string, description: string) => {
      if (!geocoder.current) return;
      geocoder.current.geocode({ placeId }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const loc = results[0].geometry.location;
          onLocationChange(loc.lat(), loc.lng(), description);
          setSelectedAddress(description);
          setPredictions([]);
          setSearchQuery("");
        }
      });
    },
    [onLocationChange],
  );

  const handleGPS = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGettingLocation(false);
        reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setGettingLocation(false);
        console.error(err);
        alert("Unable to get your location");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const center =
    latitude != null && longitude != null
      ? { lat: latitude, lng: longitude }
      : DEFAULT_CENTER;

  const mapBlock = (
    <Map
      defaultCenter={center}
      defaultZoom={latitude && longitude ? 16 : 12}
      mapTypeId="hybrid"
      mapId="location_picker_map"
      gestureHandling="greedy"
      mapTypeControl
      streetViewControl={false}
      fullscreenControl={false}
      onClick={(e) => {
        if (!e.detail.latLng) return;
        reverseGeocode(e.detail.latLng.lat, e.detail.latLng.lng);
      }}
      style={{ width: "100%", height: "100%" }}
    >
      {latitude != null && longitude != null && (
        <AdvancedMarker position={{ lat: latitude, lng: longitude }} />
      )}
    </Map>
  );

  const searchBar = (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="Search address in South Africa"
          className="pl-8 h-9 bg-background/95 backdrop-blur"
        />
        {predictions.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {predictions.map((p) => (
              <button
                key={p.place_id}
                type="button"
                onClick={() => handleSelectPlace(p.place_id, p.description)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
              >
                {p.description}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={handleSearch} disabled={isSearching} className="h-9">
        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleGPS}
        disabled={gettingLocation}
        className="h-9"
      >
        {gettingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
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
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="p-3 border-b">{searchBar}</div>
        <div className="flex-1 relative">{mapBlock}</div>
        {latitude != null && longitude != null && (
          <div className="p-2 text-sm text-muted-foreground border-t bg-background/90">
            {selectedAddress || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`}
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
          {selectedAddress || `Selected: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`}
        </p>
      )}
    </div>
  );
};

export default LocationPicker;
