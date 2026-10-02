/**
 * /field/jobs/:id — tech job sheet (step 4). No money anywhere: the header is the jobs row (RLS: assigned tech or company),
 * the packing list is get_job_packing_list (name, code, quantity, area only). Ticks are saved on this device only.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin, Package, Phone, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtQty, groupPackingList, loadTicks, saveTicks, type PackingRow } from "@/lib/packingList";

export default function FieldJobSheetPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const job = useQuery({
    queryKey: ["field-job-sheet", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, description, address, scheduled_for, status, job_type, customers(name, phone, address), leads(customer_address)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const list = useQuery({
    queryKey: ["job-packing-list", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_job_packing_list", { p_job_id: id });
      if (error) throw error;
      return (data || []) as PackingRow[];
    },
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
  const siteAddress: string | null = (j as any)?.address || (j as any)?.leads?.customer_address || (j as any)?.customers?.address || null;
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
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <Button variant="ghost" size="sm" className="h-11 gap-1.5" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      {job.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading job…</p>
      ) : !j ? (
        <Card><CardContent className="p-4 text-sm">This job is not available to you.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h1 className="text-lg font-semibold">{j.title || "Job"}</h1>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{[j.job_type, j.status].filter(Boolean).join(" · ")}</p>
            {j.scheduled_for && (
              <p className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4" />
                {new Date(j.scheduled_for).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</p>
            )}
            {j.address && (
              <a className="flex items-center gap-2 text-sm underline" href={`https://maps.google.com/?q=${encodeURIComponent(j.address)}`} target="_blank" rel="noreferrer">
                <MapPin className="h-4 w-4" />{j.address}</a>
            )}
            {j.customers?.name && (
              <p className="flex flex-wrap items-center gap-2 text-sm"><Phone className="h-4 w-4" />{j.customers.name}
                {j.customers.phone && <a className="underline" href={`tel:${j.customers.phone}`}>{j.customers.phone}</a>}</p>
            )}
            {j.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{j.description}</p>}
            {["scheduled", "dispatched", "in_progress"].includes(j.status) && (
              <div className="flex gap-2 pt-2">
                {j.status !== "in_progress" && (
                  <Button className="h-11 flex-1 gap-1.5" disabled={busy} onClick={() => setStatus("in_progress")}>
                    <Play className="h-4 w-4" /> Start job
                  </Button>
                )}
                <Button className="h-11 flex-1 gap-1.5" variant={j.status === "in_progress" ? "default" : "outline"} disabled={busy} onClick={() => setStatus("completed")}>
                  <CheckCircle2 className="h-4 w-4" /> Complete job
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <span className="text-sm font-semibold tabular-nums">× {fmtQty(r.quantity)}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
