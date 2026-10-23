/**
 * Tech "En route" (phase a2): one big orange button on the phone job screen. Marks the job dispatched via tech_set_job_status,
 * which stamps jobs.en_route_at and clears the office's at-risk alert. It does NOT message the client.
 * The leave-by hint comes from job_en_route_plan (stored addresses only, no live location).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigation, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planText, type EnRoutePlan } from "@/lib/jobWatch";

export function useEnRoutePlan(jobId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["job-en-route-plan", jobId],
    enabled: !!jobId && enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("job_en_route_plan", { p_job_id: jobId });
      if (error) return null; // plan is a hint only
      return (data ?? null) as EnRoutePlan | null;
    },
  });
}

type Props = {
  jobId: string;
  status: string;
  /** called after the job is marked en route */
  onDone?: () => void;
  /** custom action (My Jobs uses its own offline-aware mutation) */
  onPress?: () => void;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
};

export default function EnRouteButton({ jobId, status, onDone, onPress, busy: extBusy, disabled, className }: Props) {
  const plan = useEnRoutePlan(jobId, status === "scheduled");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const late = plan.data?.leave_by ? Date.now() >= new Date(plan.data.leave_by).getTime() : false;

  if (status === "dispatched") {
    return (
      <p className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 text-base font-bold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" data-testid="en-route-done">
        <CheckCircle2 className="h-5 w-5" /> You're en route
      </p>
    );
  }
  if (status !== "scheduled") return null;

  const press = async () => {
    if (onPress) return onPress();
    setBusy(true); setErr(null);
    const { error } = await (supabase.rpc as any)("tech_set_job_status", { p_job_id: jobId, p_status: "dispatched" });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone?.();
  };
  const hint = planText(plan.data);
  const working = busy || extBusy;
  return (
    <div className={cn("space-y-1.5", className)} data-testid="en-route">
      <Button
        type="button"
        onClick={press}
        disabled={working || disabled}
        className="h-auto min-h-[56px] w-full gap-2 rounded-xl bg-orange-700 text-lg font-extrabold tracking-wide text-white shadow-lg ring-2 ring-orange-300 hover:bg-orange-800 active:scale-[0.99] dark:ring-orange-500/40"
        data-testid="en-route-button"
      >
        <Navigation className="h-6 w-6" />
        {working ? "Saving…" : "I'm en route"}
      </Button>
      {hint && (
        <p className={cn("text-center text-sm", late ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")} data-testid="en-route-hint">
          {late ? "Running behind – " : ""}{hint}
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">Tells the office you're on the way. The client is not messaged.</p>
      {err && <p className="text-center text-sm font-semibold text-destructive">{err}</p>}
    </div>
  );
}
