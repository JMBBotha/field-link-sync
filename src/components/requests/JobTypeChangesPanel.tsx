import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { decideTypeChange, techJobTypeLabel, JOB_KIND_META, type JobKind } from "@/lib/jobTypeChoice";

/** Admin/owner: tech job type change requests waiting for a decision. RLS limits rows to the company's office. */
export default function JobTypeChangesPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["job-type-change-pending"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("job_type_change_requests")
        .select("id, job_id, from_type, to_type, reason, created_at, jobs(title)").eq("status", "pending").order("created_at");
      if (error) throw error;
      return (data || []) as { id: string; job_id: string; from_type: string | null; to_type: string; reason: string; created_at: string; jobs?: { title?: string | null } | null }[];
    },
  });
  if (!q.data?.length) return null;
  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      const r = await decideTypeChange(id, approve);
      if (!r?.ok) throw new Error(r?.message || "Not saved");
      toast({ title: approve ? "Approved" : "Declined", description: approve && r.lead_id ? "A New sale lead was created; the service job stays open." : undefined });
      void q.refetch();
    } catch (e) { toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  return (
    <Card data-testid="job-type-changes">
      <CardContent className="space-y-3 p-4">
        <div className="font-semibold">Job type change requests ({q.data.length})</div>
        {q.data.map((r) => (
          <div key={r.id} className="rounded-lg border p-3 text-sm">
            <Link to={`/admin/jobs/${r.job_id}`} className="font-medium underline">{r.jobs?.title || "Job"}</Link>
            <div className="text-xs text-muted-foreground">{techJobTypeLabel(r.from_type)} → {JOB_KIND_META[r.to_type as JobKind]?.icon} {JOB_KIND_META[r.to_type as JobKind]?.title ?? r.to_type}</div>
            <div className="mt-1">Why: {r.reason}</div>
            {r.to_type === "installation" && <div className="mt-1 text-xs text-muted-foreground">Approve creates a New sale lead. The service job stays open.</div>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy === r.id} onClick={() => decide(r.id, true)}>Approve</Button>
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, false)}>Decline</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
