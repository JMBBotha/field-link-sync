import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";
import { Crosshair, Loader2, MapPin, Maximize2, Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTeardropMarkerElement } from "@/utils/MarkerUtils";

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number, lng: number, address?: string) => void;
}

const LocationPicker = ({ latitude, longitude, onLocationChange }: LocationPickerProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const fullscreenMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const geocoderRef = useRef<MapboxGeocoder | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  const initializeMap = (container: HTMLDivElement, isFullscreen: boolean = false) => {
    const token = localStorage.getItem("mapbox_token");
    if (!token) return null;

    mapboxgl.accessToken = token;

    const defaultCenter: [number, number] = [18.4241, -33.9249];
    const initialCenter: [number, number] = latitude && longitude
      ? [longitude, latitude]
      : defaultCenter;

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v12",
      center: initialCenter,
      zoom: 12,
    });

    // Position zoom controls at bottom-right for fullscreen mode
    const position = isFullscreen ? "bottom-right" : "top-right";
    map.addControl(new mapboxgl.NavigationControl(), position);

    // Add geocoder (address search)
    const geocoder = new MapboxGeocoder({
      accessToken: token,
      mapboxgl: mapboxgl as any,
      marker: false,
      placeholder: "Search address...",
      flyTo: {
        speed: 1.5,
        zoom: 16,
      },
    });

    map.addControl(geocoder, "top-left");
    geocoderRef.current = geocoder;

    // When address is selected from suggestions
    geocoder.on("result", (e: any) => {
      const [lng, lat] = e.result.center;
      const address = e.result.place_name;

      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const el = createTeardropMarkerElement("#ef4444");
        markerRef.current = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map);

        markerRef.current.on("dragend", () => {
          const lngLat = markerRef.current?.getLngLat();
          if (lngLat) {
            onLocationChange(lngLat.lat, lngLat.lng);
          }
        });
      }

      onLocationChange(lat, lng, address);
    });

    // Add marker if we have initial coordinates
    if (latitude && longitude) {
      const el = createTeardropMarkerElement("#ef4444");
      markerRef.current = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat([longitude, latitude])
        .addTo(map);

      markerRef.current.on("dragend", () => {
        const lngLat = markerRef.current?.getLngLat();
        if (lngLat) {
          onLocationChange(lngLat.lat, lngLat.lng);
        }
      });
    }

    // Track if dragging to prevent click after pan
    let isDragging = false;

    map.on("dragstart", () => {
      isDragging = true;
    });

    map.on("moveend", () => {
      // Reset drag state after a short delay to allow click events to be filtered
      setTimeout(() => {
        isDragging = false;
      }, 100);
    });

    // Click to place/move marker (only on actual clicks, not after panning)
    map.on("click", (e) => {
      if (isDragging) return;

      const { lng, lat } = e.lngLat;

      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const el = createTeardropMarkerElement("#ef4444");
        markerRef.current = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .addTo(map);

        markerRef.current.on("dragend", () => {
          const lngLat = markerRef.current?.getLngLat();
          if (lngLat) {
            onLocationChange(lngLat.lat, lngLat.lng);
          }
        });
      }

      onLocationChange(lat, lng);
    });

    return map;
  };

  const handleGetCurrentLocation = async () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setGettingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        const token = localStorage.getItem("mapbox_token");

        // Update marker on map
        if (mapInstanceRef.current) {
          if (markerRef.current) {
            markerRef.current.setLngLat([lng, lat]);
          } else {
            const el = createTeardropMarkerElement("#ef4444");
            markerRef.current = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
              .setLngLat([lng, lat])
              .addTo(mapInstanceRef.current);

            markerRef.current.on("dragend", () => {
              const lngLat = markerRef.current?.getLngLat();
              if (lngLat) {
                onLocationChange(lngLat.lat, lngLat.lng);
              }
            });
          }

          mapInstanceRef.current.flyTo({
            center: [lng, lat],
            zoom: 16,
            speed: 1.5,
          });
        }

        // Reverse geocode to get address
        let address = "";
        if (token) {
          try {
            const response = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&types=address,place`
            );
            const data = await response.json();
            if (data.features && data.features.length > 0) {
              address = data.features[0].place_name;

              // Update the geocoder search bar with the address
              if (geocoderRef.current) {
                geocoderRef.current.setInput(address);
              }
            }
          } catch (error) {
            console.error("Reverse geocoding failed:", error);
          }
        }

        onLocationChange(lat, lng, address || undefined);
        setGettingLocation(false);
      },
      (error) => {
        setGettingLocation(false);
        let message = "Unable to get your location";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = "Location permission denied. Please enable location access.";
            break;
          case error.POSITION_UNAVAILABLE:
            message = "Location information unavailable.";
            break;
          case error.TIMEOUT:
            message = "Location request timed out.";
            break;
        }
        alert(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  useEffect(() => {
    const container = isFullscreen ? fullscreenMapRef.current : mapRef.current;
    if (!container) return;

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      // Cleanup previous instance safely
      if (markerRef.current) {
        try {
          markerRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
        markerRef.current = null;
      }

      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
        mapInstanceRef.current = null;
      }

      geocoderRef.current = null;

      const map = initializeMap(container, isFullscreen);
      if (map) {
        mapInstanceRef.current = map;
      }
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      if (markerRef.current) {
        try {
          markerRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [isFullscreen]);

  const token = localStorage.getItem("mapbox_token");

  if (!token) {
    return (
      <div className="h-48 rounded-md border border-dashed flex items-center justify-center bg-muted/50">
        <p className="text-sm text-muted-foreground text-center px-4">
          Map token not configured. Please set up Mapbox token in the Admin Dashboard first.
        </p>
      </div>
    );
  }

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background [&_.mapboxgl-ctrl-geocoder]:!z-20 [&_.mapboxgl-ctrl-geocoder]:!min-w-[280px] [&_.mapboxgl-ctrl-geocoder]:!shadow-lg">
        {/* Labeled buttons positioned top-right corner */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-3">
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-foreground bg-background/80 backdrop-blur px-2 py-0.5 rounded">Close</span>
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
            <span className="text-xs font-medium text-foreground bg-background/80 backdrop-blur px-2 py-0.5 rounded">Locate</span>
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
        <div ref={fullscreenMapRef} className="w-full h-full" />
        {latitude && longitude && (
          <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur px-3 py-2 rounded-md shadow">
            <p className="text-sm">
              Selected: {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>Search, or click GPS to use your current location</span>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGetCurrentLocation}
            disabled={gettingLocation}
            className="h-7 px-2"
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
            className="h-7 px-2"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={mapRef}
        className="h-48 rounded-md border overflow-hidden"
      />
      {latitude && longitude && (
        <p className="text-xs text-muted-foreground">
          Selected: {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </p>
      )}
    </div>
  );
};

export default LocationPicker;
