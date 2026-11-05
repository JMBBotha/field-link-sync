import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { jsonNumber, jsonObject, jsonString } from "@/lib/jsonValue";

export interface ServiceArea { id: string; company_id: string; name: string; center_lat: number; center_lng: number; radius_km: number; priority: number; active: boolean }
export interface RouteResult { mode: "suggest" | "applied" | "no_match" | "refused"; reason?: string | null; area?: string; company?: string; company_id?: string; km?: number; same_company?: boolean }
export interface SlotStaff { profile_id: string; name: string | null; fits: boolean; km: number | null; label: string | null; reason: string | null; best_start: string | null }

/** Ask the server which company's area covers this lead. apply=true moves an unclaimed lead (master company only). Never messages anyone. */
export async function routeLead(leadId: string, apply = false): Promise<RouteResult> {
  const { data, error } = await supabase.rpc("route_lead_to_company", { p_lead: leadId, p_apply: apply });
  if (error) throw new Error(error.message);
  return routeFromJson(data);
}

function routeFromJson(value: Json | null): RouteResult {
  const row = jsonObject(value);
  const mode = row?.mode;
  if (!row || (mode !== "suggest" && mode !== "applied" && mode !== "no_match" && mode !== "refused")) {
    return { mode: "no_match", reason: "No service area covers this address" };
  }
  return {
    mode,
    reason: jsonString(row.reason),
    area: jsonString(row.area) ?? undefined,
    company: jsonString(row.company) ?? undefined,
    company_id: jsonString(row.company_id) ?? undefined,
    km: jsonNumber(row.km) ?? undefined,
    same_company: row.same_company === true,
  };
}

export async function areaSlots(leadId: string, date: string, minutes = 120): Promise<{ areas: string[]; staff: SlotStaff[]; reason?: string }> {
  const { data, error } = await supabase.rpc("area_slot_suggestions", { p_lead: leadId, p_date: date, p_minutes: minutes });
  if (error) throw new Error(error.message);
  const row = jsonObject(data);
  const areas = Array.isArray(row?.areas) ? row.areas.filter((area): area is string => typeof area === "string") : [];
  const staff = Array.isArray(row?.staff) ? row.staff.flatMap((item) => {
    const person = jsonObject(item);
    if (!person || typeof person.profile_id !== "string") return [];
    const one: SlotStaff = {
      profile_id: person.profile_id,
      name: jsonString(person.name),
      fits: person.fits === true,
      km: jsonNumber(person.km),
      label: jsonString(person.label),
      reason: jsonString(person.reason),
      best_start: jsonString(person.best_start),
    };
    return [one];
  }) : [];
  return { areas, staff, reason: jsonString(row?.reason) ?? undefined };
}

/** Plain-words summary of a routing result. */
export function describeRoute(r: RouteResult): string {
  if (r.mode === "no_match") return r.reason || "No service area covers this address";
  if (r.mode === "refused") return `Not moved: ${r.reason}`;
  if (r.mode === "applied") return r.reason || `Moved to ${r.company}`;
  const km = r.km != null ? ` (${r.km} km from centre)` : "";
  return r.same_company ? `In your area "${r.area}"${km}` : `Best covered by ${r.company} – "${r.area}"${km}`;
}

export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");
