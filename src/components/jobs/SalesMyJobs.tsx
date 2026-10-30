import TechLocationBlock from "@/components/jobs/TechLocationBlock";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import JobInfoBlock from "@/components/jobs/JobInfoBlock";
import { assignedLabel, cardHref } from "@/lib/assignedLabel";
import { photoDisplayPath, signedPhotoUrl } from "@/lib/photoUrls";

type MyJob = {
  lead_id: string; job_id: string | null; customer: string | null; title: string | null;
  tech_name: string | null; tech_status: string; scheduled_date: string | null; scheduled_time: string | null;
  stage: "assigned" | "en_route" | "on_site" | "completed"; job_types: string[] | null; job_info: string | null; photos: number;
};
const STAGES = [["assigned", "Assigned"], ["en_route", "En route"], ["on_site", "On site"], ["completed", "Completed"]] as const;
const TECH: Record<string, string> = { available: "Available", busy: "Busy" };

/** Read-only photos for a followed lead (RLS: own company + rep follows the lead). Signed URLs. */
function JobPhotos({ leadId }: { leadId: string }) {
  const q = useQuery({
    queryKey: ["sales-job-photos", leadId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("job_photos") as any)
        .select("id, storage_path, annotated_path, photo_type").eq("lead_id", leadId).order("created_at", { ascending: true }).limit(60);
      if (error) throw error;
      return Promise.all(((data ?? []) as any[]).map(async (p) => ({ id: p.id, type: p.photo_type as string, url: await signedPhotoUrl(photoDisplayPath(p)) })));
    },
  });
  if (q.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">No photos yet.</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5" data-testid="sales-job-photos">
      {q.data.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-md border">
          <img src={p.url} alt={`${p.type} photo`} className="h-full w-full object-cover" loading="lazy" />
          <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] capitalize text-white">{p.type}</span>
        </a>
      ))}
    </div>
  );
}

/** Sales home: jobs on leads this rep owns, quoted or assigned. Own jobs only (server-side). */
export default function SalesMyJobs() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["sales-my-jobs"], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("sales_my_jobs", { p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as MyJob[];
    },
  });
  // Bell tap (?myjob=<leadId>): scroll to + highlight the item; not in My jobs yet -> open the lead page.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const target = params.get("myjob");
  const [hl, setHl] = useState<string | null>(null);
  useEffect(() => {
    if (!target || !q.data) return;
    const next = new URLSearchParams(params); next.delete("myjob");
    if (q.data.some((j) => j.lead_id === target)) {
      setHl(target);
      setParams(next, { replace: true });
      setTimeout(() => document.getElementById(`myjob-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      setTimeout(() => setHl(null), 4000);
    } else navigate(`/admin/bookings/${target}`, { replace: true });
  }, [target, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="v7-solid space-y-2 rounded-2xl border bg-card p-3" data-testid="sales-my-jobs">
      <h2 className="text-base font-semibold">My jobs</h2>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" />
        : !q.data?.length ? <p className="text-sm text-muted-foreground">Jobs on your leads, quotes and assignments show here once a technician is on them.</p>
        : q.data.map((j) => {
          const idx = STAGES.findIndex(([s]) => s === j.stage);
          return (
            <div key={j.lead_id} id={`myjob-${j.lead_id}`} className={`space-y-2 rounded-xl border p-3 transition-shadow ${hl === j.lead_id ? "ring-2 ring-primary" : ""}`} data-testid="sales-my-job">
              <button type="button" onClick={() => navigate(cardHref(j)!)} className="block w-full space-y-1 text-left" data-testid="sales-my-job-open" aria-label={`Open ${j.job_id ? "job" : "booking"} for ${j.customer || "customer"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="min-w-0 truncate font-semibold">{j.customer || "Customer"}</p>
                  <span className="text-xs font-semibold text-primary">{j.job_id ? "Open job ›" : "Open booking ›"}</span>
                </div>
                {j.title && <p className="text-xs text-muted-foreground">{j.title}</p>}
                <p className="text-sm font-medium" data-testid="sales-my-job-assigned">
                  {assignedLabel(j.tech_name, j.scheduled_date, j.scheduled_time) || <span className="text-muted-foreground">No technician yet{j.scheduled_date ? ` · ${j.scheduled_date}` : ""}</span>}
                  {j.tech_name?.trim() ? <span className="text-muted-foreground"> · {TECH[j.tech_status] || "Off"}</span> : null}
                </p>
              </button>
              {j.job_id && <TechLocationBlock jobId={j.job_id} compact />}
              <ol className="grid grid-cols-4 gap-1" aria-label="Job progress">
                {STAGES.map(([s, label], i) => (
                  <li key={s} aria-current={i === idx ? "step" : undefined} className="space-y-1 text-center">
                    <div className={`h-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`} />
                    <span className={`block text-[11px] leading-tight ${i === idx ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
                  </li>
                ))}
              </ol>
              <JobInfoBlock types={j.job_types} info={j.job_info} />
              {j.photos > 0 && (
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(open === j.lead_id ? null : j.lead_id)}>
                  {open === j.lead_id ? "Hide photos" : `Photos (${j.photos})`}
                </Button>
              )}
              {open === j.lead_id && <JobPhotos leadId={j.lead_id} />}
            </div>
          );
        })}
    </section>
  );
}
