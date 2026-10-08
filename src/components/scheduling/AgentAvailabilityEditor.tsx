import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Clock, Save, Loader2 } from "lucide-react";
import { hhmm } from "@/lib/schedulingDefaults";
import { TimeInput24 } from "@/components/ui/time-input-24";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DaySchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const fromCompany = (c?: { work_days: number[] | null; work_start: string | null; work_end: string | null } | null): DaySchedule[] =>
  DAYS.map((_, i) => ({
    day_of_week: i,
    start_time: hhmm(c?.work_start || "08:00"),
    end_time: hhmm(c?.work_end || "17:00"),
    is_available: c?.work_days ? c.work_days.includes(i) : i >= 1 && i <= 5,
  }));

interface Props {
  agentId?: string; // if not provided, uses current user
}

/** Reads/writes staff_work_hours (never agent_availability). Shows the company default when the person has no rows. */
const AgentAvailabilityEditor = ({ agentId }: Props) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [schedule, setSchedule] = useState<DaySchedule[]>(fromCompany());
  const [usingDefault, setUsingDefault] = useState(true);
  const userId = agentId ?? user?.id ?? null;

  const { data: companyId, isLoading } = useQuery({
    queryKey: ["staff-work-hours", userId],
    queryFn: async () => {
      const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", userId!).maybeSingle();
      const cid = prof?.company_id ?? null;
      const { data: company } = cid
        ? await supabase.from("companies").select("work_days, work_start, work_end").eq("id", cid).maybeSingle()
        : { data: null };
      const base = fromCompany(company);
      const { data, error } = await supabase.from("staff_work_hours").select("*").eq("profile_id", userId!);
      if (error) throw error;
      setUsingDefault(!data?.length);
      setSchedule(base.map((d) => {
        const r = data?.find((x) => x.day_of_week === d.day_of_week);
        return r ? { day_of_week: d.day_of_week, start_time: hhmm(r.start_time || d.start_time), end_time: hhmm(r.end_time || d.end_time), is_available: r.is_working } : d;
      }));
      return cid;
    },
    enabled: !!userId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !companyId) throw new Error("No user or company");
      const rows = schedule.map((d) => ({
        profile_id: userId,
        company_id: companyId,
        day_of_week: d.day_of_week,
        start_time: d.start_time + ":00",
        end_time: d.end_time + ":00",
        is_working: d.is_available,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("staff_work_hours").upsert(rows, { onConflict: "profile_id,day_of_week" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Working hours saved" });
      setUsingDefault(false);
      queryClient.invalidateQueries({ queryKey: ["staff-work-hours"] });
      queryClient.invalidateQueries({ queryKey: ["staff-work-window"] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const updateDay = (dayIndex: number, field: keyof DaySchedule, value: any) => {
    setSchedule((prev) => prev.map((d) => (d.day_of_week === dayIndex ? { ...d, [field]: value } : d)));
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Weekly Availability
        </CardTitle>
        {usingDefault && !isLoading && <p className="text-xs text-muted-foreground">Showing the company's working hours.</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading schedule...</div>
        ) : (
          <>
            {schedule.map((day) => (
              <div key={day.day_of_week} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 border-b border-border/50 last:border-0">
                <Switch
                  checked={day.is_available}
                  onCheckedChange={(v) => updateDay(day.day_of_week, "is_available", v)}
                />
                <span className={`w-24 text-sm font-medium ${day.is_available ? "text-foreground" : "text-muted-foreground"}`}>
                  {DAYS[day.day_of_week]}
                </span>
                {day.is_available && (
                  <div className="flex w-full sm:w-auto items-center gap-2 pl-12 sm:pl-0">
                    <TimeInput24 value={day.start_time} onChange={(e) => updateDay(day.day_of_week, "start_time", e.target.value)} className="w-28 h-8 text-sm" />
                    <span className="text-muted-foreground text-xs">to</span>
                    <TimeInput24 value={day.end_time} onChange={(e) => updateDay(day.day_of_week, "end_time", e.target.value)} className="w-28 h-8 text-sm" />
                  </div>
                )}
              </div>
            ))}
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full mt-2">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Availability
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AgentAvailabilityEditor;
