import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Phone } from "lucide-react";
import { RULES } from "@/lib/nextSteps";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import JobInfoBlock from "@/components/jobs/JobInfoBlock";
import { assignedLabel, isAssigned } from "@/lib/assignedLabel";
import { friendlyWhen } from "@/lib/friendlyWhen";
import EditBookingSheet from "@/components/jobs/EditBookingSheet";
import JobPhotosCard from "@/components/jobs/JobPhotosCard";
import BookingVisitsCard from "@/components/jobs/BookingVisits";
import AddJobPhotosButton from "@/components/jobs/AddJobPhotosButton";
import SetPinDialog from "@/components/jobs/SetPinDialog";
import LinkifiedText from "@/components/shared/LinkifiedText";
import { mapHref } from "@/lib/mapPin";
import { bookingStatus, editableBookingFields, type BookingPerms } from "@/lib/bookingEdit";

/**
 * Booking detail for a lead that is booked/assigned but has no job yet (e.g. a service call booked with a tech).
 * Open to every staff role; RLS decides what the person may read (reps: leads they follow / clients they own).
 * When assigned, the status reads "Assigned to <tech> · <when>"; reassigning lives in More, never as the main button.
 */
export default function AdminBookingDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [edit, setEdit] = useState<null | "all" | "notes">(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const closeMore = () => moreRef.current?.removeAttribute("open");
  const q = useQuery({
    queryKey: ["booking-detail", leadId], enabled: !!leadId,
    queryFn: async () => {
      const { data: l, error } = await supabase.from("leads")
        .select("id, customer_name, customer_phone, customer_address, customer_id, company_id, assigned_agent_id, scheduled_date, scheduled_time, service_type, job_types, job_info, status, lead_status, notes, latitude, longitude")
        .eq("id", leadId!).maybeSingle();
      if (error) throw error;
      if (!l) return null;
      const [{ data: sched }, { data: job }] = await Promise.all([
        supabase.from("job_schedules").select("agent_id, scheduled_date, start_time").eq("lead_id", l.id).order("scheduled_date", { ascending: true }).limit(1),
        supabase.from("jobs").select("id").eq("lead_id", l.id).not("status", "in", "(cancelled,canceled)").order("created_at", { ascending: false }).limit(1),
      ]);
      const { data: perms } = await supabase.rpc("booking_edit_perms", { p_lead: l.id });
      const s = sched?.[0];
      const techId = l.assigned_agent_id || s?.agent_id || null;
      let techName: string | null = null;
      if (techId) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", techId).maybeSingle();
        techName = (p as any)?.full_name?.trim() || "Technician";
      }
      return { ...l, assigned_agent_id: techId, tech_name: techName, date: l.scheduled_date || s?.scheduled_date || null,
        time: l.scheduled_time || s?.start_time || null, job_id: job?.[0]?.id ?? null, perms: (perms ?? null) as BookingPerms | null };
    },
  });
  const b: any = q.data;
  // A job exists now -> the job page is the right place.
  useEffect(() => { if (b?.job_id) navigate(`/admin/jobs/${b.job_id}`, { replace: true }); }, [b?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/admin"));
  if (q.isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!b || b.perms?.view === false) return (
    <div className="space-y-3 p-4">
      <p className="text-sm">This booking isn't available to you.</p>
      <Button variant="outline" onClick={() => navigate("/admin")}>Back to Home</Button>
    </div>
  );
  const assigned = isAssigned(b);
  const label = assignedLabel(b.tech_name, b.date, b.time);
  const f = editableBookingFields(b.perms);
  const st = bookingStatus(b.status, b.lead_status, assigned);
  const stCls = { green: "bg-[#E8F5E9] text-[#1B5E20]", amber: "bg-[#FFF3E0] text-[#8A3B00]", red: "bg-[#FDECEA] text-[#B71C1C]", blue: "bg-[#E3F2FD] text-[#0D47A1]" }[st.tone];
  // Exact pin first (stored lat/lng, else coordinates in the notes), typed address last (Johan t2045u).
  const map = mapHref({ lat: b.latitude, lng: b.longitude, notes: b.notes, address: b.customer_address });
  return (
    <div className="v8-scope mx-auto max-w-3xl space-y-3 p-3 sm:p-6" data-testid="booking-detail">
      {/* One back arrow: the shared header BackButton (Johan 31 Oct). */}
      {/* One white header card with a status pill (UI polish 4/5). */}
      <div className="space-y-3 rounded-2xl border bg-white p-4" data-testid="booking-header">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#475569]">Booking{b.service_type ? ` · ${b.service_type}` : ""}</p>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stCls}`} data-testid="booking-status">{st.label}</span>
        </div>
        <h1 className="text-[24px] font-semibold leading-tight break-words text-[#0F1B2A]">{b.customer_name || "Client"}</h1>
        {b.customer_address && <p className="flex items-start gap-1 text-sm text-[#334155]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{b.customer_address}</p>}
        <p data-testid="booking-assigned">
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${assigned ? "bg-[#E8F5E9] text-[#1B5E20]" : "bg-[#FFF3E0] text-[#8A3B00]"}`}>
            {assigned ? (label || `Tech: ${b.tech_name}`) : (b.date ? `${friendlyWhen(b.date, b.time)} · No technician yet` : "No technician yet")}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Never a dead end: assigned bookings get Reschedule / reassign as the main step (sweep 1 Nov). */}
          {!assigned && <button type="button" className="fl-btn-primary px-5" onClick={() => setAssignOpen(true)} data-testid="booking-assign">{RULES.assign_tech.action}</button>}
          {assigned && <button type="button" className="fl-btn-primary px-5" onClick={() => setAssignOpen(true)} data-testid="booking-reassign">Reschedule / reassign</button>}
          {b.customer_phone && <a className="fl-btn-secondary inline-flex items-center px-4" href={`tel:${b.customer_phone}`}><Phone className="mr-1 h-4 w-4" />Call</a>}
          {map && <a className="fl-btn-secondary inline-flex items-center px-4" href={map} target="_blank" rel="noreferrer"><MapPin className="mr-1 h-4 w-4" />Map</a>}
          {(f.any || b.customer_id) && (
            <details ref={moreRef} className="relative" data-testid="booking-more">
              <summary className="fl-btn-text inline-flex cursor-pointer list-none items-center px-3">⋯ More</summary>
              <div className="absolute left-0 z-20 mt-1 flex w-56 flex-col rounded-xl border bg-card p-1 shadow-lg">
                {f.any && <button onClick={() => { closeMore(); setEdit("all"); }} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="booking-edit">Edit booking</button>}
                {b.customer_id && <button onClick={() => { closeMore(); navigate(`/admin/customers/${b.customer_id}`); }} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted">Open client</button>}
                {f.any && <button onClick={() => { closeMore(); setPinOpen(true); }} className="min-h-11 rounded-lg px-3 text-left text-[14px] hover:bg-muted" data-testid="booking-set-pin">Set map pin</button>}
              </div>
            </details>
          )}
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-3 space-y-2" data-testid="booking-notes">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold">Job notes</p>
          {f.notes && <button type="button" className="fl-btn-text px-2" onClick={() => setEdit("notes")} data-testid="booking-notes-edit">{b.notes ? "Edit" : "Add"}</button>}</div>
        <JobInfoBlock types={b.job_types} info={b.job_info} />
        {b.notes ? (
          <div role={f.notes ? "button" : undefined} tabIndex={f.notes ? 0 : undefined} onClick={() => f.notes && setEdit("notes")} className="block w-full whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 text-left text-sm" data-testid="booking-notes-text"><LinkifiedText text={b.notes} /></div>
        ) : !b.job_types?.length && !b.job_info && (
          f.notes
            ? <button type="button" onClick={() => setEdit("notes")} className="block w-full rounded-lg border border-dashed p-3 text-left text-sm text-muted-foreground" data-testid="booking-notes-add">No job notes yet. Tap to add.</button>
            : <p className="text-sm text-muted-foreground">No job notes yet.</p>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
      <BookingVisitsCard leadId={b.id} companyId={b.company_id} perms={{ admin: !!b.perms?.admin, rep: !!b.perms?.rep }}
        seed={{ date: b.date, time: b.time }} onSaved={() => q.refetch()} />
      <JobPhotosCard leadId={b.id} addSlot={f.any ? <AddJobPhotosButton leadId={b.id} defaultType="site" /> : null} />
      </div>
      {edit && <EditBookingSheet key={edit} open onOpenChange={(o) => !o && setEdit(null)} notesOnly={edit === "notes"} perms={b.perms}
        booking={{ id: b.id, date: b.scheduled_date ?? b.date, time: b.scheduled_time ?? b.time, notes: b.notes ?? null, service_type: b.service_type, customer_address: b.customer_address }}
        onSaved={() => q.refetch()} />}
      {pinOpen && <SetPinDialog open onClose={() => setPinOpen(false)} leadId={b.id} lat={b.latitude} lng={b.longitude} notes={b.notes}
        address={b.customer_address} canSetAddress={!!b.perms?.admin} onSaved={() => q.refetch()} />}
      <LeadAssignDialog leadId={assignOpen ? b.id : null} onClose={() => { setAssignOpen(false); q.refetch(); }} />
    </div>
  );
}
