/**
 * /field/jobs/:id — tech job sheet (step 4). No money anywhere: the header is the jobs row (RLS: assigned tech or company),
 * the packing list is get_job_packing_list (name, code, quantity, area only). Ticks are saved on this device only.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, CheckCircle2, MapPin, Navigation, Package, Phone, Play } from "lucide-react";
import FieldShell from "@/components/field/FieldShell";
import EnRouteButton from "@/components/field/EnRouteButton";
import { SitePhotosReadOnly } from "@/components/photos/SitePhotosSection";
import { useToast } from "@/hooks/use-toast";
import SiteCheckCard, { siteCheckBlock, useSiteCheck } from "@/components/field/SiteCheckCard";
import { loadJobSheet, loadPackingList } from "@/lib/jobPack";
import { siteCheckHints } from "@/lib/siteSurvey/pack";
import SurveyPackSection, { FrontPhoto, useSurveyPack } from "@/components/survey/SurveyPackSection";
import { packQtyText, groupPackingList, loadTicks, saveTicks, type PackingRow } from "@/lib/packingList";

export default function FieldJobSheetPage() {
  const { id = "" } = useParams();
  const job = useQuery({
    queryKey: ["field-job-sheet", id],
    enabled: !!id,
    queryFn: () => loadJobSheet(id),
  });
  const list = useQuery({
    queryKey: ["job-packing-list", id],
    enabled: !!id,
    queryFn: () => loadPackingList(id),
  });
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  useEffect(() => setTicks(loadTicks(id)), [id]);

  // Live: a reschedule or address change in the office shows here without a refresh
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`field-job-sheet-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${id}` }, () => job.refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const toggle = (key: string) =>
    setTicks((t) => { const next = { ...t, [key]: !t[key] }; saveTicks(id, next); return next; });

  const groups = groupPackingList(list.data || []);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const done = groups.reduce((n, g) => n + g.rows.filter((r) => ticks[r.key]).length, 0);
  const j = job.data;
  // Site check (phone/online install quotes): Start/Complete stay locked until costs are confirmed
  const site = useSiteCheck(id, (job.data as any)?.site_check_status ?? null);
  const blocked = siteCheckBlock(site.data);
  const siteAddress: string | null = (j as any)?.address || (j as any)?.leads?.customer_address || (j as any)?.customers?.address || null;
  const pack = useSurveyPack(j?.lead_id ?? null);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const setStatus = async (status: "in_progress" | "completed") => {
    if (status === "completed" && !window.confirm("Mark this job as completed?")) return;
    setBusy(true);
    const { error } = await (supabase.rpc as any)("tech_set_job_status", { p_job_id: id, p_status: status });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't update the job", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "completed" ? "Job completed" : "Job started" });
    job.refetch();
  };


  return (
    <FieldShell title="Job sheet" back>
      <div className="space-y-4">
      {job.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading job…</p>
      ) : !j ? (
        <Card><CardContent className="p-4 text-sm">This job is not available to you.</CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <FrontPhoto survey={pack.data} className="aspect-[16/9] rounded-none" />
          <CardContent className="space-y-2 p-4">
            <h2 className="text-lg font-semibold">{j.title || "Job"}</h2>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{[j.job_type, j.status].filter(Boolean).join(" · ")}</p>
            {j.scheduled_for && (
              <p className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4" />
                {new Date(j.scheduled_for).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</p>
            )}
            {["scheduled", "dispatched"].includes(j.status) && (
              <EnRouteButton jobId={id} status={j.status} className="py-1"
                onDone={() => { toast({ title: "Marked en route", description: "The office can see you're on the way." }); job.refetch(); }} />
            )}
            {siteAddress && (
              <a className="flex items-center gap-2 text-sm underline" href={`https://maps.google.com/?q=${encodeURIComponent(siteAddress)}`} target="_blank" rel="noreferrer">
                <MapPin className="h-4 w-4" />{siteAddress}</a>
            )}
            {j.customers?.name && (
              <p className="flex flex-wrap items-center gap-2 text-sm"><Phone className="h-4 w-4" />{j.customers.name}
                {j.customers.phone && <a className="underline" href={`tel:${j.customers.phone}`}>{j.customers.phone}</a>}</p>
            )}
            {(siteAddress || j.customers?.phone) && (
              <div className="grid grid-cols-2 gap-2" data-testid="job-pack-actions">
                {siteAddress ? <Button asChild variant="outline" className="min-h-[44px]"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(siteAddress)}`} target="_blank" rel="noreferrer"><Navigation className="mr-1 h-4 w-4" />Navigate</a></Button> : <span />}
                {j.customers?.phone ? <Button asChild variant="outline" className="min-h-[44px]"><a href={`tel:${j.customers.phone}`}><Phone className="mr-1 h-4 w-4" />Call client</a></Button> : <span />}
              </div>
            )}
            {j.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{j.description}</p>}
            {blocked && ["scheduled", "dispatched", "in_progress"].includes(j.status) && (
              <p className="rounded-lg bg-amber-50 dark:bg-amber-500/15 p-2 text-sm font-semibold text-amber-800 dark:text-amber-300" data-testid="job-locked-reason">{blocked}</p>
            )}
            {["scheduled", "dispatched", "in_progress"].includes(j.status) && (
              <div className="flex gap-2 pt-2">
                {j.status !== "in_progress" && (
                  <Button className="h-11 flex-1 gap-1.5" variant={j.status === "scheduled" ? "outline" : "default"} disabled={busy || !!blocked} onClick={() => setStatus("in_progress")}>
                    <Play className="h-4 w-4" /> Start job
                  </Button>
                )}
                <Button className="h-11 flex-1 gap-1.5" variant={j.status === "in_progress" ? "default" : "outline"} disabled={busy || !!blocked} onClick={() => setStatus("completed")}>
                  <CheckCircle2 className="h-4 w-4" /> Complete job
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {j && site.data && !["completed", "cancelled"].includes(j.status) && (
        <SiteCheckCard jobId={id} leadId={j.lead_id} info={site.data} onDone={() => { void site.refetch(); void job.refetch(); }} survey={siteCheckHints(pack.data)} />
      )}

      {/* Job pack: the rep's site survey (rooms, photos, pipe runs, notes). Read-only, no money. */}
      {j?.lead_id && <SurveyPackSection leadId={j.lead_id} />}

      {/* P2: salesperson's site photos for this job's lead (read-only, no money) */}
      {job.data?.lead_id && <SitePhotosReadOnly leadId={job.data.lead_id} />}

      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold"><Package className="h-4 w-4" /> Packing list</h2>
        {total > 0 && <span className="text-sm text-muted-foreground">{done}/{total} packed</span>}
      </div>
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading packing list…</p>
      ) : list.error ? (
        <p className="text-sm text-muted-foreground">Packing list not available.</p>
      ) : !total ? (
        <p className="text-sm text-muted-foreground">No materials on this job's quote.</p>
      ) : (
        groups.map((g) => (
          <Card key={g.area}>
            <CardContent className="p-0">
              <p className="border-b px-4 py-2 text-sm font-semibold">{g.area}</p>
              {g.rows.map((r) => (
                <label key={r.key} className="flex min-h-11 cursor-pointer items-center gap-3 border-b px-4 py-2 last:border-0">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={!!ticks[r.key]} onChange={() => toggle(r.key)} aria-label={`Packed ${r.item_name || r.item_code}`} />
                  <span className={`min-w-0 flex-1 text-sm ${ticks[r.key] ? "text-muted-foreground line-through" : ""}`}>
                    {r.item_name || r.item_code}
                    <span className="block text-xs text-muted-foreground">{[r.item_code, r.kit_name && `in ${r.kit_name}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{packQtyText(r)}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))
      )}
      </div>
    </FieldShell>
  );
}
