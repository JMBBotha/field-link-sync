import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, MapPin, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import JobInfoBlock from "@/components/jobs/JobInfoBlock";
import { assignedLabel, isAssigned } from "@/lib/assignedLabel";
import { friendlyWhen } from "@/lib/friendlyWhen";

/**
 * Booking detail for a lead that is booked/assigned but has no job yet (e.g. a service call booked with a tech).
 * Open to every staff role; RLS decides what the person may read (reps: leads they follow / clients they own).
 * When assigned, the status reads "Assigned to <tech> · <when>"; reassigning lives in More, never as the main button.
 */
export default function AdminBookingDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = useState(false);
  const q = useQuery({
    queryKey: ["booking-detail", leadId], enabled: !!leadId,
    queryFn: async () => {
      const { data: l, error } = await (supabase.from("leads") as any)
        .select("id, customer_name, customer_phone, customer_address, customer_id, assigned_agent_id, scheduled_date, scheduled_time, service_type, job_types, job_info, status")
        .eq("id", leadId!).maybeSingle();
      if (error) throw error;
      if (!l) return null;
      const [{ data: sched }, { data: job }] = await Promise.all([
        (supabase.from("job_schedules") as any).select("agent_id, scheduled_date, start_time").eq("lead_id", l.id).order("scheduled_date", { ascending: true }).limit(1),
        (supabase.from("jobs") as any).select("id").eq("lead_id", l.id).not("status", "in", "(cancelled,canceled)").order("created_at", { ascending: false }).limit(1),
      ]);
      const s = sched?.[0];
      const techId = l.assigned_agent_id || s?.agent_id || null;
      let techName: string | null = null;
      if (techId) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", techId).maybeSingle();
        techName = (p as any)?.full_name?.trim() || "Technician";
      }
      return { ...l, assigned_agent_id: techId, tech_name: techName, date: l.scheduled_date || s?.scheduled_date || null,
        time: l.scheduled_time || s?.start_time || null, job_id: job?.[0]?.id ?? null };
    },
  });
  const b: any = q.data;
  // A job exists now -> the job page is the right place.
  useEffect(() => { if (b?.job_id) navigate(`/admin/jobs/${b.job_id}`, { replace: true }); }, [b?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/admin"));
  if (q.isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!b) return (
    <div className="space-y-3 p-4">
      <p className="text-sm">This booking isn't available to you.</p>
      <Button variant="outline" onClick={() => navigate("/admin")}>Back to Home</Button>
    </div>
  );
  const assigned = isAssigned(b);
  const label = assignedLabel(b.tech_name, b.date, b.time);
  const map = b.customer_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.customer_address)}` : null;
  return (
    <div className="v8-scope mx-auto max-w-3xl space-y-3 p-3 sm:p-6" data-testid="booking-detail">
      <Button variant="ghost" className="-ml-2 min-h-[44px]" onClick={back}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
      <div className="space-y-2 rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Booking</p>
        <h1 className="text-xl font-semibold leading-tight break-words">{b.customer_name || "Client"}</h1>
        {b.customer_address && <p className="flex items-start gap-1 text-sm opacity-90"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{b.customer_address}</p>}
        {b.service_type && <p className="text-sm opacity-90">{b.service_type}</p>}
      </div>
      <div className={`rounded-2xl border-2 p-4 ${assigned ? "border-[#2E7D32] bg-[#F1F8F1]" : "border-[#E65100] bg-[#FFF8F1]"}`} data-testid="booking-assigned">
        <p className={`text-[16px] font-semibold ${assigned ? "text-[#1B5E20]" : "text-[#E65100]"}`}>
          {label || (b.date ? `Booked · ${friendlyWhen(b.date, b.time)} · no technician yet` : "Not assigned yet")}
        </p>
        {!assigned && <Button className="mt-3 min-h-11 bg-[#1590D6]" onClick={() => setAssignOpen(true)} data-testid="booking-assign">Assign / schedule</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {b.customer_phone && <Button asChild variant="outline" className="min-h-11"><a href={`tel:${b.customer_phone}`}><Phone className="mr-1 h-4 w-4" />Call</a></Button>}
        {map && <Button asChild variant="outline" className="min-h-11"><a href={map} target="_blank" rel="noreferrer"><MapPin className="mr-1 h-4 w-4" />Map</a></Button>}
        {b.customer_id && <Button variant="outline" className="min-h-11" onClick={() => navigate(`/admin/customers/${b.customer_id}`)}>Open client</Button>}
        {assigned && (
          <details className="relative" data-testid="booking-more">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border px-3 text-sm font-medium">More</summary>
            <div className="absolute left-0 z-20 mt-1 flex w-56 flex-col rounded-xl border bg-card p-1 shadow-lg">
              <button onClick={() => setAssignOpen(true)} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="booking-reassign">Reassign / reschedule</button>
            </div>
          </details>
        )}
      </div>
      <div className="rounded-2xl border p-3"><JobInfoBlock types={b.job_types} info={b.job_info} />{!b.job_types?.length && !b.job_info && <p className="text-sm text-muted-foreground">No job notes yet.</p>}</div>
      <LeadAssignDialog leadId={assignOpen ? b.id : null} onClose={() => { setAssignOpen(false); q.refetch(); }} />
    </div>
  );
}
