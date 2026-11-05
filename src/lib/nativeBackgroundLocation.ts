import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

/** Notification the Android foreground service must show while sharing is on. */
export const LOCATION_NOTIFICATION_TITLE = "Field Lynk";
export const LOCATION_NOTIFICATION_BODY = "Field Lynk is sharing location while you're Available";

/** Freshness on Live Map is 15 minutes. A 4-minute heartbeat stays inside that. */
export const LOCATION_PING_INTERVAL_MS = 4 * 60 * 1000;

type LocationFix = { latitude: number; longitude: number };

type Watcher = {
  start: (options: Record<string, unknown>, cb: (location?: LocationFix | null, error?: { code?: string; message?: string } | null) => void) => Promise<void>;
  stop: () => Promise<void>;
  updateHeaders: (options: { headers: Record<string, string> }) => Promise<void>;
  requestPermissions: (options?: { permissions?: string[] }) => Promise<unknown>;
};

let watcher: Watcher | null = null;
let running = false;
let starting: Promise<void> | null = null;
let onFix: ((fix: LocationFix) => void) | null = null;

async function loadWatcher(): Promise<Watcher | null> {
  if (watcher) return watcher;
  try {
    const mod = await import("@capgo/background-geolocation");
    watcher = mod.BackgroundGeolocation as unknown as Watcher;
    return watcher;
  } catch (err) {
    console.error("[location] background plugin unavailable", err);
    return null;
  }
}

function nativePingUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/agent-location-ping`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { waitForAuthSession } = await import("@/contexts/AuthContext");
  const session = await waitForAuthSession();
  const token = session?.access_token;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apikey) headers.apikey = apikey;
  return headers;
}

/**
 * Android foreground-service watcher (@capgo/background-geolocation).
 * On the web this still starts the plugin's browser fallback so an open tab
 * can ping, and it stops the moment sharing is no longer allowed.
 * Native POSTs keep the Live Map fresh after the WebView is gone; the server
 * drops anything that is not Available.
 */
export async function startBackgroundLocation(onLocation: (fix: LocationFix) => void): Promise<void> {
  onFix = onLocation;
  if (running) return;
  if (starting) return starting;
  starting = startWatcher().finally(() => { starting = null; });
  return starting;
}

async function startWatcher(): Promise<void> {
  const plugin = await loadWatcher();
  if (!plugin) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await plugin.requestPermissions({ permissions: ["location", "backgroundLocation", "notification"] });
    } catch (err) {
      console.error("[location] permission request failed", err);
    }
  }
  const url = Capacitor.isNativePlatform() ? nativePingUrl() : null;
  const headers = url ? await authHeaders() : undefined;
  await plugin.start(
    {
      backgroundTitle: LOCATION_NOTIFICATION_TITLE,
      backgroundMessage: LOCATION_NOTIFICATION_BODY,
      requestPermissions: true,
      stale: false,
      // 0 keeps a heartbeat while the phone is sitting still. A non-zero filter
      // would suppress those and the Live Map pin would go stale inside 15 min.
      distanceFilter: 0,
      minIntervalMs: LOCATION_PING_INTERVAL_MS,
      networkFallback: true,
      ...(url && headers ? { url, headers } : {}),
    },
    (location, error) => {
      if (error) {
        if (error.code !== "NOT_AUTHORIZED") console.error("[location] watcher", error.message || error.code);
        return;
      }
      if (location && onFix) onFix(location);
    },
  );
  running = true;
}

export async function stopBackgroundLocation(): Promise<void> {
  onFix = null;
  if (!running && !watcher) return;
  try {
    await watcher?.stop();
  } catch (err) {
    console.error("[location] stop failed", err);
  } finally {
    running = false;
  }
}

export async function refreshBackgroundLocationHeaders(): Promise<void> {
  if (!running || !watcher || !Capacitor.isNativePlatform()) return;
  try {
    await watcher.updateHeaders({ headers: await authHeaders() });
  } catch (err) {
    console.error("[location] header refresh failed", err);
  }
}

export function backgroundLocationRunning(): boolean {
  return running;
}
