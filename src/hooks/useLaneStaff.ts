import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LeadLane } from "@/lib/leadLane";

export type DispatchRole = "sales" | "technician";

export interface LaneStaffMember {
  id: string;
  full_name: string;
  phone: string | null;
  availability_status: string | null;
  dispatch_role: DispatchRole | null;
  participant_type: string | null;
  roles: string[];
  /** Effective lane after fallbacks. */
  lane: LeadLane | null;
}

/**
 * Resolve someone's lane.
 * - explicit profiles.dispatch_role wins
 * - independent techs are service-only
 * - fallback: field_agent role => technician
 * - fallback: untagged company staff (admin/dispatcher) can take sales leads
 */
export function resolveLane(m: {
  dispatch_role?: string | null;
  participant_type?: string | null;
  roles?: string[];
}): LeadLane | null {
  if (m.dispatch_role === "sales") return m.participant_type === "independent_tech" ? "service" : "sales";
  if (m.dispatch_role === "technician") return "service";
  if (m.participant_type === "independent_tech") return "service";
  const roles = m.roles || [];
  if (roles.includes("field_agent")) return "service";
  if (roles.includes("admin") || roles.includes("dispatcher")) return "sales";
  return null;
}

/** Company-scoped staff with their lanes (RLS keeps this to the caller's company). */
export function useLaneStaff() {
  const query = useQuery({
    queryKey: ["lane-staff"],
    queryFn: async (): Promise<LaneStaffMember[]> => {
      const { data: roleRows, error: roleErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (roleErr) throw roleErr;

      const rolesById = new Map<string, string[]>();
      for (const r of roleRows || []) {
        const list = rolesById.get(r.user_id) || [];
        list.push(r.role as string);
        rolesById.set(r.user_id, list);
      }

      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("id, full_name, phone, availability_status, dispatch_role, participant_type");
      if (profErr) throw profErr;

      return (profiles || []).map((p: any) => {
        const roles = rolesById.get(p.id) || [];
        return {
          id: p.id,
          full_name: p.full_name || "Unnamed",
          phone: p.phone ?? null,
          availability_status: p.availability_status ?? null,
          dispatch_role: (p.dispatch_role as DispatchRole | null) ?? null,
          participant_type: p.participant_type ?? null,
          roles,
          lane: resolveLane({ ...p, roles }),
        };
      });
    },
  });

  const staff = query.data || [];
  return {
    staff,
    salesStaff: staff.filter((s) => s.lane === "sales"),
    technicians: staff.filter((s) => s.lane === "service"),
    laneById: new Map(staff.map((s) => [s.id, s.lane] as const)),
    isLoading: query.isLoading,
  };
}
