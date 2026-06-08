import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  isGeolocationSupported,
  checkLocationPermission,
  getCurrentPosition,
  LocationPermissionStatus,
} from "@/lib/geolocation";

interface UseGeolocationOptions {
  enableTracking?: boolean;
  updateInterval?: number; // in milliseconds
  onLocationUpdate?: (lat: number, lng: number) => void;
}

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: number | null;
  loading: boolean;
  error: string | null;
  permissionStatus: LocationPermissionStatus;
  isTracking: boolean;
}

const isGeoError = (e: unknown): e is GeolocationPositionError =>
  typeof e === "object" && e !== null && "code" in e && "message" in e;

export const useGeolocation = (options: UseGeolocationOptions = {}) => {
  const { enableTracking = false, updateInterval = 300000, onLocationUpdate } = options; // 5 min default

  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    timestamp: null,
    loading: false,
    error: null,
    permissionStatus: "unknown",
    isTracking: false,
  });

  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const mountedRef = useRef(true);
  // Mirror latest coords so the periodic interval doesn't read a stale closure
  const coordsRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  // Keep latest callback so changing it doesn't force consumers to memoize
  const onLocationUpdateRef = useRef(onLocationUpdate);
  useEffect(() => { onLocationUpdateRef.current = onLocationUpdate; }, [onLocationUpdate]);

  // Check permission status on mount
  useEffect(() => {
    mountedRef.current = true;
    const checkPermission = async () => {
      try {
        const status = await checkLocationPermission();
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, permissionStatus: status }));
      } catch (err) {
        console.error("useGeolocation checkPermission error:", err);
      }
    };
    void checkPermission();
    return () => { mountedRef.current = false; };
  }, []);

  // Update agent location in database
  const updateAgentLocation = useCallback(
    async (lat: number, lng: number, isAvailable: boolean = true) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase.from("agent_locations").upsert(
          {
            agent_id: user.id,
            latitude: lat,
            longitude: lng,
            is_available: isAvailable,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );
        if (error) {
          console.error("Error updating agent location:", error);
          return;
        }
        lastUpdateRef.current = Date.now();
      } catch (error) {
        console.error("Error updating agent location:", error);
      }
    },
    []
  );

  // Get current position once
  const refreshLocation = useCallback(async () => {
    if (!isGeolocationSupported()) {
      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: "Geolocation is not supported by your browser",
        }));
      }
      return null;
    }

    if (mountedRef.current) {
      setState((prev) => ({ ...prev, loading: true, error: null }));
    }

    try {
      const position = await getCurrentPosition();
      const { latitude, longitude, accuracy } = position.coords;

      coordsRef.current = { lat: latitude, lng: longitude };

      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          latitude,
          longitude,
          accuracy,
          timestamp: position.timestamp,
          loading: false,
          permissionStatus: "granted",
        }));
      }

      onLocationUpdateRef.current?.(latitude, longitude);
      await updateAgentLocation(latitude, longitude);

      return { latitude, longitude };
    } catch (error: unknown) {
      let errorMessage = "Unable to get location";

      if (isGeoError(error)) {
        if (error.code === 1) {
          errorMessage = "Location permission denied";
          if (mountedRef.current) {
            setState((prev) => ({ ...prev, permissionStatus: "denied" }));
          }
        } else if (error.code === 2) {
          errorMessage = "Location unavailable";
        } else if (error.code === 3) {
          errorMessage = "Location request timed out";
        }
      }

      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
      }

      return null;
    }
  }, [updateAgentLocation]);

  // Start continuous tracking
  const startTracking = useCallback(async () => {
    if (!isGeolocationSupported()) {
      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: "Geolocation is not supported",
        }));
      }
      return;
    }

    // Request initial position
    await refreshLocation();

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        coordsRef.current = { lat: latitude, lng: longitude };

        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            latitude,
            longitude,
            accuracy,
            timestamp: position.timestamp,
            isTracking: true,
            permissionStatus: "granted",
            error: null,
          }));
        }

        // Only update database if enough time has passed
        if (Date.now() - lastUpdateRef.current >= updateInterval) {
          updateAgentLocation(latitude, longitude).catch((err) =>
            console.error("watchPosition update error:", err)
          );
          onLocationUpdateRef.current?.(latitude, longitude);
        }
      },
      (error) => {
        let errorMessage = "Location error";
        if (error.code === 1) {
          errorMessage = "Location permission denied";
          if (mountedRef.current) {
            setState((prev) => ({ ...prev, permissionStatus: "denied" }));
          }
        }
        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            error: errorMessage,
            isTracking: false,
          }));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );

    // Set up periodic database updates — read coords from ref to avoid stale closure
    intervalRef.current = setInterval(() => {
      const { lat, lng } = coordsRef.current;
      if (lat !== null && lng !== null) {
        updateAgentLocation(lat, lng).catch((err) =>
          console.error("periodic update error:", err)
        );
      }
    }, updateInterval);

    if (mountedRef.current) {
      setState((prev) => ({ ...prev, isTracking: true }));
    }
  }, [refreshLocation, updateAgentLocation, updateInterval]);

  // Stop tracking
  const stopTracking = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Update availability to false
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { lat, lng } = coordsRef.current;
      if (user && lat !== null && lng !== null) {
        await supabase.from("agent_locations").upsert(
          {
            agent_id: user.id,
            latitude: lat,
            longitude: lng,
            is_available: false,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );
      }
    } catch (error) {
      console.error("Error updating availability:", error);
    }

    if (mountedRef.current) {
      setState((prev) => ({ ...prev, isTracking: false }));
    }
  }, []);

  // Auto-start tracking if enabled
  useEffect(() => {
    if (enableTracking) {
      startTracking().catch((err) =>
        console.error("useGeolocation auto-start error:", err)
      );
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enableTracking, startTracking]);

  return {
    ...state,
    refreshLocation,
    startTracking,
    stopTracking,
    isSupported: isGeolocationSupported(),
  };
};
