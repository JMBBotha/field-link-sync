import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "mapbox_token";
let cached: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * Get the shared Mapbox public token.
 * Priority:
 *   1. In-memory cache
 *   2. Build-time VITE_MAPBOX_PUBLIC_TOKEN (if provided)
 *   3. Edge function `mapbox-token` (returns server-configured MAPBOX_ACCESS_TOKEN)
 *   4. Legacy localStorage("mapbox_token") fallback for existing installs
 *
 * The result is cached in-memory and mirrored to localStorage so that
 * synchronous callers (e.g. legacy `localStorage.getItem("mapbox_token")`)
 * continue to work without a prompt.
 */
export async function getMapboxToken(): Promise<string> {
  if (cached) return cached;

  const buildToken = (import.meta as any).env?.VITE_MAPBOX_PUBLIC_TOKEN as string | undefined;
  if (buildToken && buildToken.startsWith("pk.")) {
    cached = buildToken;
    try { localStorage.setItem(STORAGE_KEY, buildToken); } catch {}
    return buildToken;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("mapbox-token");
      const token = (data as any)?.token as string | undefined;
      if (!error && token && token.startsWith("pk.")) {
        cached = token;
        try { localStorage.setItem(STORAGE_KEY, token); } catch {}
        return token;
      }
    } catch {
      /* fall through */
    }
    // Legacy fallback
    const legacy = (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) || "";
    if (legacy) cached = legacy;
    return legacy;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Synchronous best-effort read — returns cached / localStorage value or "". */
export function getMapboxTokenSync(): string {
  if (cached) return cached;
  try {
    const t = localStorage.getItem(STORAGE_KEY) || "";
    if (t) cached = t;
    return t;
  } catch {
    return "";
  }
}

/** Kick off a fetch early so later sync callers find it cached. */
export function primeMapboxToken(): void {
  if (!cached) void getMapboxToken();
}
