import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, Phone } from "lucide-react";
import { toast } from "sonner";

type Alert = { id: string; job_id: string; profile_id: string | null; rule: string; severity: string; message: string; created_at: string };

export const RULE_LABEL: Record<string, string> = {
  not_accepted: "Not accepted",
  not_accepted_urgent: "Not accepted · starts soon",
  no_en_route: "No “on my way”",
  not_started: "Not started",
  not_finished: "Not marked done",
};

/** Open job-watchdog alerts (office only via RLS). Each stays until the job moves on or someone dismisses it. */
export default function JobWatchdogPanel({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data = [], refetch } = useQuery({
    queryKey: ["job-alerts"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: a } = await (supabase.from("job_alerts" as any) as any)
        .select("id, job_id, profile_id, rule, severity, message, created_at")
        .is("resolved_at", null).order("created_at", { ascending: false }).limit(50);
      const alerts = (a || []) as Alert[];
      const ids = [...new Set(alerts.map((x) => x.profile_id).filter(Boolean))] as string[];
      const phones = new Map<string, string | null>();
      if (ids.length) {
        const { data: p } = await supabase.from("profiles").select("id, phone").in("id", ids);
        ((p as any[]) || []).forEach((r) => phones.set(r.id, r.phone));
      }
      return alerts.map((x) => ({ ...x, phone: x.profile_id ? phones.get(x.profile_id) ?? null : null }));
    },
  });
  if (!data.length) return null;

  const dismiss = async (id: string) => {
    const reason = window.prompt("What was done? (e.g. called tech, reassigned)");
    if (reason === null) return;
    const { error } = await (supabase.from("job_alerts" as any) as any)
      .update({ resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null, resolution: reason || "dismissed" }).eq("id", id);
    if (error) return toast.error("Could not dismiss: " + error.message);
    refetch();
  };

  return (
    <section data-testid="job-watchdog" className={cn("rounded-xl border border-destructive/40 bg-destructive/5 p-2", className)}>
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-bold tracking-wide text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> JOBS NOT MOVING ({data.length})
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {data.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold",
              a.severity === "critical" ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning-foreground")}>
              {RULE_LABEL[a.rule] ?? a.rule}
            </span>
            <span className="min-w-0 flex-1 text-xs">{a.message}</span>
            <div className="flex gap-1">
              {a.phone && <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs"><a href={`tel:${a.phone}`}><Phone className="mr-1 h-3 w-3" />Call</a></Button>}
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => navigate(`/admin/jobs/${a.job_id}`)}>Open</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => dismiss(a.id)}>Dismiss</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
