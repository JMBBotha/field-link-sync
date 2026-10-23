import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { hhmm, toMinutes, WORK_DAYS, WORK_END, WORK_START } from "@/lib/schedulingDefaults";

export interface CompanyHoursInfo {
  workDays: number[];
  workStart: string; // "08:00"
  workEnd: string; // "17:00"
  /** Full day length in minutes (work_end − work_start), e.g. 540 for 08:00–17:00. */
  fullDayMinutes: number;
}

export const FALLBACK_COMPANY_HOURS: CompanyHoursInfo = {
  workDays: WORK_DAYS,
  workStart: WORK_START,
  workEnd: WORK_END,
  fullDayMinutes: toMinutes(WORK_END) - toMinutes(WORK_START),
};

export function toCompanyHours(row: { work_days?: number[] | null; work_start?: string | null; work_end?: string | null } | null | undefined): CompanyHoursInfo {
  if (!row) return FALLBACK_COMPANY_HOURS;
  const workStart = hhmm(row.work_start) || WORK_START;
  const workEnd = hhmm(row.work_end) || WORK_END;
  const span = toMinutes(workEnd) - toMinutes(workStart);
  return {
    workDays: row.work_days?.length ? row.work_days : WORK_DAYS,
    workStart,
    workEnd,
    fullDayMinutes: span > 0 ? span : FALLBACK_COMPANY_HOURS.fullDayMinutes,
  };
}

/** Own company's working hours (company isolation: only the caller's company row is read). */
export function useCompanyHours(): CompanyHoursInfo {
  const { data } = useQuery({
    queryKey: ["company-hours"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const cid = await getUserCompanyId(auth.user?.id);
      if (!cid) return null;
      const { data } = await supabase.from("companies").select("work_days, work_start, work_end").eq("id", cid).maybeSingle();
      return data ?? null;
    },
  });
  return toCompanyHours(data as any);
}
