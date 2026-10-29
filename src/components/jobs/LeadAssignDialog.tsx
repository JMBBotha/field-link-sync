import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Loader2 } from "lucide-react";
import { todayInJohannesburg } from "@/lib/todaysJobs";
import SitePhotosSection from "@/components/photos/SitePhotosSection";
import LeadPhotoUploader from "@/components/jobs/LeadPhotoUploader";

export const JOB_TYPES = [{ v: "service", l: "Service" }, { v: "repair", l: "Repair" }, { v: "installation", l: "Installation" }] as const;

export type AssignTech = { id: string; full_name: string; status: string; km: number | null; current?: boolean | null; day_slots?: string[] };
type Req = { id: string; by?: string | null; preferred?: string | null; preferred_tech_id?: string | null; reason?: string | null; created_at: string };
type Opts = {
  ok: boolean; message?: string; mode: "assign" | "reassign" | "request"; office: boolean;
  lead: { id: string; name: string | null; service_type: string | null; lane: string | null; scheduled_date: string | null; scheduled_time: string | null; minutes: number; assigned_name: string | null; job_types?: string[] | null; job_info?: string | null };
  techs: AssignTech[]; requests: Req[];
};

const STATUS: Record<string, string> = { available: "Available", busy: "Busy" };
export const techLabel = (t: AssignTech) =>
  `${t.full_name} · ${STATUS[t.status] || "Off"}${t.km != null ? ` · ${t.km} km` : ""}${t.current ? " (now)" : ""}`;
const hhmm = (t?: string | null) => (t || "08:00").slice(0, 5);
const plusMin = (t: string, m: number) => { const [h, mm] = t.split(":").map(Number); const x = Math.min(23 * 60 + 59, h * 60 + mm + m); return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

/**
 * Assign a lead to a technician (own company only, decided server-side).
 * Office: assign / reassign + sees sales' reassignment requests. Sales: assign unassigned leads only,
 * otherwise "Request reassignment" (in-app record for the office, nothing is sent to anyone).
 */
export default function LeadAssignDialog({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tech, setTech] = useState("");
  const [date, setDate] = useState(todayInJohannesburg());
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("10:00");
  const [reason, setReason] = useState("");
  const [inited, setInited] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [info, setInfo] = useState("");
  /** Sales: after assigning, stay open so they can add remote-quote photos (allowed once they assigned it). */
  const [photoStep, setPhotoStep] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["lead-assign-options", leadId, inited === leadId ? date : null], enabled: !!leadId, placeholderData: (prev: any) => prev,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("lead_assign_options", { p_lead_id: leadId, p_date: inited === leadId ? date : null });
      if (error) throw error;
      return data as Opts;
    },
  });
  useEffect(() => { if (!leadId) { setInited(null); setPhotoStep(null); } }, [leadId]);
  useEffect(() => {
    if (!data?.ok || !leadId || inited === leadId || data.lead.id !== leadId) return;
    setInited(leadId);
    const s = hhmm(data.lead.scheduled_time);
    setTech(""); setReason("");
    setTypes(data.lead.job_types || []); setInfo(data.lead.job_info || "");
    setDate(data.lead.scheduled_date || todayInJohannesburg());
    setStart(s); setEnd(plusMin(s, data.lead.minutes || 120));
  }, [data]);

  const done = (msg: string, keepOpen = false) => {
    toast({ title: msg });
    ["lead-assign-options", "dispatch-cards-leads", "dispatch-leads", "dispatch-schedules", "jobs-calm-booked", "pending-reassign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    if (!keepOpen) onClose();
  };
  const fail = (e: any) => toast({ title: "Not saved", description: e?.message || String(e), variant: "destructive" });

  const assign = useMutation({
    mutationFn: async () => {
      const { data: r, error } = await (supabase.rpc as any)("assign_lead_to_tech", { p_lead_id: leadId, p_tech_id: tech, p_date: date, p_start: start, p_end: end, p_job_types: types, p_job_info: info });
      if (error) throw error;
      if (!r?.ok) throw new Error(r?.message || "Not saved");
    },
    onSuccess: () => {
      const name = data?.techs.find((t) => t.id === tech)?.full_name || "technician";
      if (data?.office) return done(`Assigned to ${name}`);
      setPhotoStep(name); done(`Assigned to ${name}`, true);
    }, onError: fail,
  });
  const request = useMutation({
    mutationFn: async () => {
      const { data: r, error } = await (supabase.rpc as any)("request_lead_reassignment", { p_lead_id: leadId, p_preferred_tech_id: tech || null, p_reason: reason });
      if (error) throw error;
      if (!r?.ok) throw new Error(r?.message || "Not saved");
    },
    onSuccess: () => done("Reassignment requested. The office will decide."), onError: fail,
  });
  const decline = useMutation({
    mutationFn: async (id: string) => {
      const { data: r, error } = await (supabase.rpc as any)("decline_lead_reassignment", { p_request_id: id });
      if (error) throw error;
      if (!r?.ok) throw new Error(r?.message || "Not saved");
    },
    onSuccess: () => { toast({ title: "Request declined" }); qc.invalidateQueries({ queryKey: ["lead-assign-options"] }); qc.invalidateQueries({ queryKey: ["pending-reassign"] }); }, onError: fail,
  });

  const mode = data?.mode;
  const notService = data?.ok && data.lead.lane !== "service";
  const busy = assign.isPending || request.isPending;
  const alreadyAsked = mode === "request" && (data?.requests?.length || 0) > 0;

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-md" data-testid="lead-assign-dialog">
        <DialogHeader>
          <DialogTitle>{mode === "request" ? "Request reassignment" : mode === "reassign" ? "Reassign lead" : "Assign lead"}</DialogTitle>
          <DialogDescription>
            {data?.ok ? <><span className="font-semibold">{data.lead.name}</span>{data.lead.service_type ? ` – ${data.lead.service_type}` : ""}{data.lead.assigned_name ? ` · now with ${data.lead.assigned_name.trim()}` : ""}</> : " "}
          </DialogDescription>
        </DialogHeader>

        {photoStep && leadId ? (
          <div className="space-y-3 text-sm" data-testid="lead-photo-step">
            <p>Assigned to <span className="font-semibold">{photoStep}</span>. Add photos the customer sent for a remote quote (optional).</p>
            <LeadPhotoUploader leadId={leadId} />
            <p className="text-xs text-muted-foreground">Photos stay private to your company. The technician sees them on the job once assigned.</p>
          </div>
        ) : isLoading ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : !data?.ok ? <p className="text-sm text-muted-foreground">{data?.message || "Lead not found"}</p>
          : notService ? (
            <div className="space-y-2 text-sm">
              <p>This is a sales lead. Technicians are assigned to service leads only.</p>
              {data.office && <Button size="sm" variant="outline" onClick={() => { onClose(); navigate(`/admin/jobs?lead=${data.lead.id}`); }}>Open lead details</Button>}
            </div>
          ) : (
            <div className="space-y-4">
              {data.office && data.requests.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="reassign-requests">
                  <p className="font-semibold">Reassignment requested</p>
                  {data.requests.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p>{(r.by || "Sales").trim()}{r.preferred ? ` prefers ${r.preferred.trim()}` : ""}</p>
                        {r.reason && <p className="text-xs text-muted-foreground">“{r.reason}”</p>}
                      </div>
                      <div className="flex gap-1">
                        {r.preferred_tech_id && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTech(r.preferred_tech_id!)}>Use</Button>}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={decline.isPending} onClick={() => decline.mutate(r.id)}>Decline</Button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Reassigning below approves the request.</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="lad-tech">{mode === "request" ? "Preferred technician (optional)" : "Technician"}</Label>
                <select id="lad-tech" value={tech} onChange={(e) => setTech(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{data.techs.length ? (mode === "request" ? "No preference" : "Select technician") : "No technicians in your company yet"}</option>
                  {data.techs.map((t) => <option key={t.id} value={t.id}>{techLabel(t)}{mode !== "request" ? (t.day_slots?.length ? ` · booked ${t.day_slots.join(", ")}` : " · free that day") : ""}</option>)}
                </select>
                {mode !== "request" && tech && (() => { const t = data.techs.find((x) => x.id === tech); return t ? <p className="text-xs text-muted-foreground" data-testid="tech-day">{t.day_slots?.length ? `On ${date}: booked ${t.day_slots.join(", ")}` : `On ${date}: no bookings`}</p> : null; })()}
                {data.techs.length > 0 && data.techs.every((t) => t.km == null) && <p className="text-xs text-muted-foreground">Distance shows once a technician has a saved location.</p>}
              </div>

              {mode === "request" ? (
                alreadyAsked ? <p className="text-sm text-muted-foreground">You already asked. The office will decide based on availability and location.</p> : (
                  <div className="space-y-2">
                    <Label htmlFor="lad-reason">Reason</Label>
                    <Textarea id="lad-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer asked for an earlier visit" />
                    <p className="text-xs text-muted-foreground">The office sees this on the lead and decides. Nothing is sent to anyone.</p>
                  </div>
                )
              ) : (
                <>
                  <div className="space-y-2"><Label htmlFor="lad-date">Date</Label><Input id="lad-date" type="date" min={todayInJohannesburg()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /><p className="text-xs text-muted-foreground">Any future date. The list shows each technician's bookings on this day.</p></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Start</Label><TimeInput24 value={start} onChange={(e: any) => setStart(e.target.value)} /></div>
                    <div className="space-y-2"><Label>End</Label><TimeInput24 value={end} onChange={(e: any) => setEnd(e.target.value)} /></div>
                  </div>
                  <div className="space-y-2">
                    <Label>Job type</Label>
                    <div className="flex flex-wrap gap-2" data-testid="job-types">
                      {JOB_TYPES.map((t) => {
                        const on = types.includes(t.v);
                        return <button key={t.v} type="button" aria-pressed={on} onClick={() => setTypes(on ? types.filter((x) => x !== t.v) : [...types, t.v])}
                          className={`h-9 rounded-full border px-3 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{t.l}</button>;
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lad-info">Job information</Label>
                    <Textarea id="lad-info" value={info} maxLength={4000} rows={3} onChange={(e) => setInfo(e.target.value)} placeholder="What the technician needs to know, e.g. unit model, fault, access" />
                    <p className="text-xs text-muted-foreground">Only the assigned technician sees this, with the client details.</p>
                  </div>
                  {data.office && <SitePhotosSection leadId={data.lead.id} />}
                </>
              )}
            </div>
          )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{photoStep ? "Done" : "Cancel"}</Button>
          {!photoStep && data?.ok && !notService && (mode === "request"
            ? !alreadyAsked && <Button disabled={busy || !reason.trim()} onClick={() => request.mutate()}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Send request</Button>
            : <Button disabled={busy || !tech} onClick={() => assign.mutate()}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{mode === "reassign" ? "Reassign" : "Assign"}</Button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
