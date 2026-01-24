// Geolocation utilities for distance calculation and location tracking

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
export const calculateDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

/**
 * Format distance for display
 */
export const formatDistance = (distanceKm: number): string => {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`;
  }
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)}km`;
  }
  return `${Math.round(distanceKm)}km`;
};

/**
 * Check if a location is within a radius of another location
 */
export const isWithinRadius = (
  centerLat: number,
  centerLng: number,
  targetLat: number,
  targetLng: number,
  radiusKm: number
): boolean => {
  return calculateDistanceKm(centerLat, centerLng, targetLat, targetLng) <= radiusKm;
};

/**
 * Get compass direction from one point to another
 */
export const getDirection = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): string => {
  const dLng = toLng - fromLng;
  const y = Math.sin(toRadians(dLng)) * Math.cos(toRadians(toLat));
  const x =
    Math.cos(toRadians(fromLat)) * Math.sin(toRadians(toLat)) -
    Math.sin(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.cos(toRadians(dLng));
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const normalizedBearing = (bearing + 360) % 360;

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(normalizedBearing / 45) % 8;
  return directions[index];
};

/**
 * Check if geolocation is supported
 */
export const isGeolocationSupported = (): boolean => {
  return "geolocation" in navigator;
};

/**
 * Get current position as a promise
 */
export const getCurrentPosition = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(new Error("Geolocation is not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000, // 1 minute cache
    });
  });
};

/**
 * Permission status types
 */
export type LocationPermissionStatus = "granted" | "denied" | "prompt" | "unknown";

/**
 * Check location permission status
 */
export const checkLocationPermission = async (): Promise<LocationPermissionStatus> => {
  if (!("permissions" in navigator)) {
    return "unknown";
  }

  try {
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state as LocationPermissionStatus;
  } catch {
    return "unknown";
  }
};

export interface BroadcastRadiusSettings {
  sales: number;
  technical: number;
  default: number;
}

export const DEFAULT_BROADCAST_RADIUS: BroadcastRadiusSettings = {
  sales: 30,
  technical: 50,
  default: 40,
};

/**
 * Get broadcast radius for a service type
 */
export const getBroadcastRadiusForType = (
  serviceType: string,
  settings: BroadcastRadiusSettings
): number => {
  const lowerType = serviceType.toLowerCase();
  if (lowerType.includes("sales") || lowerType.includes("consultation")) {
    return settings.sales;
  }
  if (
    lowerType.includes("repair") ||
    lowerType.includes("installation") ||
    lowerType.includes("maintenance") ||
    lowerType.includes("technical")
  ) {
    return settings.technical;
  }
  return settings.default;
};
