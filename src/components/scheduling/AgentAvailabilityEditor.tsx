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

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DaySchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DEFAULT_SCHEDULE: DaySchedule[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: "08:00",
  end_time: "17:00",
  is_available: i >= 1 && i <= 5, // Mon-Fri on by default
}));

interface Props {
  agentId?: string; // if not provided, uses current user
}

const AgentAvailabilityEditor = ({ agentId }: Props) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_SCHEDULE);
  const userId = agentId ?? user?.id ?? null;

  const { isLoading } = useQuery({
    queryKey: ["agent-availability", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_availability")
        .select("*")
        .eq("agent_id", userId!);
      if (error) throw error;
      if (data && data.length > 0) {
        const merged = DEFAULT_SCHEDULE.map((d) => {
          const existing = data.find((r: any) => r.day_of_week === d.day_of_week);
          return existing
            ? { day_of_week: existing.day_of_week, start_time: existing.start_time?.slice(0, 5) || "08:00", end_time: existing.end_time?.slice(0, 5) || "17:00", is_available: existing.is_available }
            : d;
        });
        setSchedule(merged);
      }
      return data;
    },
    enabled: !!userId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("No user");
      // Upsert all 7 days
      const rows = schedule.map((d) => ({
        agent_id: userId,
        day_of_week: d.day_of_week,
        start_time: d.start_time + ":00",
        end_time: d.end_time + ":00",
        is_available: d.is_available,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("agent_availability").upsert(rows, { onConflict: "agent_id,day_of_week" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Availability saved" });
      queryClient.invalidateQueries({ queryKey: ["agent-availability"] });
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
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading schedule...</div>
        ) : (
          <>
            {schedule.map((day) => (
              <div key={day.day_of_week} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <Switch
                  checked={day.is_available}
                  onCheckedChange={(v) => updateDay(day.day_of_week, "is_available", v)}
                />
                <span className={`w-24 text-sm font-medium ${day.is_available ? "text-foreground" : "text-muted-foreground"}`}>
                  {DAYS[day.day_of_week]}
                </span>
                {day.is_available && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={day.start_time}
                      onChange={(e) => updateDay(day.day_of_week, "start_time", e.target.value)}
                      className="w-28 h-8 text-sm"
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <Input
                      type="time"
                      value={day.end_time}
                      onChange={(e) => updateDay(day.day_of_week, "end_time", e.target.value)}
                      className="w-28 h-8 text-sm"
                    />
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