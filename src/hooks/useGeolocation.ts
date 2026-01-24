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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Check permission status on mount
  useEffect(() => {
    const checkPermission = async () => {
      const status = await checkLocationPermission();
      setState((prev) => ({ ...prev, permissionStatus: status }));
    };
    checkPermission();
  }, []);

  // Update agent location in database
  const updateAgentLocation = useCallback(
    async (lat: number, lng: number, isAvailable: boolean = true) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        await supabase.from("agent_locations").upsert(
          {
            agent_id: user.id,
            latitude: lat,
            longitude: lng,
            is_available: isAvailable,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );

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
      setState((prev) => ({
        ...prev,
        error: "Geolocation is not supported by your browser",
      }));
      return null;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const position = await getCurrentPosition();
      const { latitude, longitude, accuracy } = position.coords;

      setState((prev) => ({
        ...prev,
        latitude,
        longitude,
        accuracy,
        timestamp: position.timestamp,
        loading: false,
        permissionStatus: "granted",
      }));

      onLocationUpdate?.(latitude, longitude);
      await updateAgentLocation(latitude, longitude);

      return { latitude, longitude };
    } catch (error: any) {
      let errorMessage = "Unable to get location";

      if (error.code === 1) {
        errorMessage = "Location permission denied";
        setState((prev) => ({ ...prev, permissionStatus: "denied" }));
      } else if (error.code === 2) {
        errorMessage = "Location unavailable";
      } else if (error.code === 3) {
        errorMessage = "Location request timed out";
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return null;
    }
  }, [onLocationUpdate, updateAgentLocation]);

  // Start continuous tracking
  const startTracking = useCallback(async () => {
    if (!isGeolocationSupported()) {
      setState((prev) => ({
        ...prev,
        error: "Geolocation is not supported",
      }));
      return;
    }

    // Request initial position
    await refreshLocation();

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;

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

        // Only update database if enough time has passed
        if (Date.now() - lastUpdateRef.current >= updateInterval) {
          await updateAgentLocation(latitude, longitude);
          onLocationUpdate?.(latitude, longitude);
        }
      },
      (error) => {
        let errorMessage = "Location error";
        if (error.code === 1) {
          errorMessage = "Location permission denied";
          setState((prev) => ({ ...prev, permissionStatus: "denied" }));
        }
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          isTracking: false,
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );

    // Set up periodic database updates
    intervalRef.current = setInterval(async () => {
      if (state.latitude && state.longitude) {
        await updateAgentLocation(state.latitude, state.longitude);
      }
    }, updateInterval);

    setState((prev) => ({ ...prev, isTracking: true }));
  }, [refreshLocation, updateAgentLocation, updateInterval, onLocationUpdate, state.latitude, state.longitude]);

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
      if (user && state.latitude && state.longitude) {
        await supabase.from("agent_locations").upsert(
          {
            agent_id: user.id,
            latitude: state.latitude,
            longitude: state.longitude,
            is_available: false,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "agent_id" }
        );
      }
    } catch (error) {
      console.error("Error updating availability:", error);
    }

    setState((prev) => ({ ...prev, isTracking: false }));
  }, [state.latitude, state.longitude]);

  // Auto-start tracking if enabled
  useEffect(() => {
    if (enableTracking) {
      startTracking();
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enableTracking]);

  return {
    ...state,
    refreshLocation,
    startTracking,
    stopTracking,
    isSupported: isGeolocationSupported(),
  };
};
