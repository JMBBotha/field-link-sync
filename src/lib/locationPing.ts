import { supabase } from "@/integrations/supabase/client";
import { mayShareLocation, type ShareSnapshot } from "@/lib/availabilitySchedule";

const EMPTY: ShareSnapshot = {
  signedIn: false,
  trackingEnabled: false,
  status: "offline",
  schedule: null,
};

let snapshot: ShareSnapshot = EMPTY;

export function getLocationShareSnapshot(): ShareSnapshot {
  return snapshot;
}

export function setLocationShareSnapshot(next: ShareSnapshot) {
  snapshot = next;
}

export function clearLocationShareSnapshot() {
  snapshot = EMPTY;
}

/**
 * One write path for agent_locations. Refuses the call entirely when sharing
 * is off, so a Not-available or opted-out phone never refreshes the pin.
 * The database trigger rejects the same cases if a caller skips this check.
 */
export async function shareLocationIfAllowed(lat: number, lng: number, at: Date = new Date()): Promise<boolean> {
  if (!mayShareLocation(snapshot, at)) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const { error } = await (supabase.rpc as any)("record_my_location_ping", { p_lat: lat, p_lng: lng });
  if (error) {
    console.error("[location] ping rejected", error.message);
    return false;
  }
  return true;
}
