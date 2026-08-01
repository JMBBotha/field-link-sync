import { supabase } from "@/integrations/supabase/client";
import { geocodeAddress } from "@/lib/geocodeAddress";

/** True only for real, plottable coordinates (never 0,0 / null / NaN / out of range). */
export function hasValidCoords(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return false;
  return true;
}

const PLACEHOLDER_RE = /(address pending|pending\s*—|to be confirmed|unknown address)/i;

function usableAddress(addr?: string | null): string | null {
  const a = (addr || "").trim();
  if (a.length < 5) return null;
  if (PLACEHOLDER_RE.test(a)) return null;
  return a;
}

interface CoordLead {
  id: string;
  customer_id?: string | null;
  customer_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  [k: string]: any;
}

/**
 * Resolve coordinates for leads:
 *  1. Prefer the linked customer's primary location coordinates.
 *  2. Otherwise geocode the address string and persist the result.
 *  3. Leave coords null when nothing valid can be resolved (no ocean pins).
 */
export async function resolveLeadCoords<T extends CoordLead>(leads: T[]): Promise<T[]> {
  const needs = leads.filter((l) => !hasValidCoords(l.latitude, l.longitude));
  if (needs.length === 0) return leads;

  const customerIds = Array.from(
    new Set(needs.map((l) => l.customer_id).filter(Boolean))
  ) as string[];

  const locByCustomer = new Map<string, { lat: number; lng: number; address?: string | null }>();
  if (customerIds.length > 0) {
    const { data } = await (supabase as any)
      .from("customer_locations")
      .select("customer_id, address, latitude, longitude, is_primary")
      .in("customer_id", customerIds);
    for (const loc of (data || []) as any[]) {
      if (!hasValidCoords(loc.latitude, loc.longitude)) continue;
      const existing = locByCustomer.get(loc.customer_id);
      if (!existing || loc.is_primary) {
        locByCustomer.set(loc.customer_id, {
          lat: Number(loc.latitude),
          lng: Number(loc.longitude),
          address: loc.address,
        });
      }
    }
  }

  const resolved = new Map<string, { lat: number; lng: number }>();

  for (const lead of needs) {
    const fromCustomer = lead.customer_id ? locByCustomer.get(lead.customer_id) : undefined;
    if (fromCustomer) {
      resolved.set(lead.id, { lat: fromCustomer.lat, lng: fromCustomer.lng });
      continue;
    }
    const addr = usableAddress(lead.customer_address);
    if (!addr) continue;
    const geo = await geocodeAddress(addr);
    if (geo && hasValidCoords(geo.latitude, geo.longitude)) {
      resolved.set(lead.id, { lat: geo.latitude, lng: geo.longitude });
    }
  }

  // Persist so the fix sticks (best effort — ignore write failures).
  await Promise.all(
    Array.from(resolved.entries()).map(([id, c]) =>
      supabase
        .from("leads")
        .update({ latitude: c.lat, longitude: c.lng })
        .eq("id", id)
        .then(() => undefined, () => undefined)
    )
  );

  return leads.map((l) => {
    const c = resolved.get(l.id);
    if (!c) {
      return hasValidCoords(l.latitude, l.longitude)
        ? l
        : ({ ...l, latitude: null, longitude: null } as T);
    }
    return { ...l, latitude: c.lat, longitude: c.lng } as T;
  });
}
