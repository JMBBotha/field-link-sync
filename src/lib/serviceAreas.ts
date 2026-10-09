import { supabase } from "@/integrations/supabase/client";

export interface ServiceArea { id: string; company_id: string; name: string; center_lat: number; center_lng: number; radius_km: number; priority: number; active: boolean }
export interface RouteResult { mode: "suggest" | "applied" | "no_match" | "refused"; reason?: string | null; area?: string; company?: string; company_id?: string; km?: number; same_company?: boolean }
export interface SlotStaff { profile_id: string; name: string | null; fits: boolean; km: number | null; label: string | null; reason: string | null; best_start: string | null }

/** Ask the server which company's area covers this lead. apply=true moves an unclaimed lead (master company only). Never messages anyone. */
export async function routeLead(leadId: string, apply = false): Promise<RouteResult> {
  const { data, error } = await (supabase.rpc as any)("route_lead_to_company", { p_lead: leadId, p_apply: apply });
  if (error) throw new Error(error.message);
  return data as RouteResult;
}

export async function areaSlots(leadId: string, date: string, minutes = 120): Promise<{ areas: string[]; staff: SlotStaff[]; reason?: string }> {
  const { data, error } = await (supabase.rpc as any)("area_slot_suggestions", { p_lead: leadId, p_date: date, p_minutes: minutes });
  if (error) throw new Error(error.message);
  return data;
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
