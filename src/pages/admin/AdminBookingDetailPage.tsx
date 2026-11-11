import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import EditBookingSheet from "@/components/jobs/EditBookingSheet";
import JobPhotosCard from "@/components/jobs/JobPhotosCard";
import BookingVisitsCard from "@/components/jobs/BookingVisits";
import AddJobPhotosButton from "@/components/jobs/AddJobPhotosButton";
import SetPinDialog from "@/components/jobs/SetPinDialog";
import BookingDetailView, { type BookingQuoteLink } from "@/components/jobs/BookingDetailView";
import LeadCloseActions from "@/components/leads/LeadCloseActions";
import { editableBookingFields, type BookingPerms } from "@/lib/bookingEdit";
import type { CancelVisitReasonId } from "@/lib/cancelVisit";

/**
 * Booking detail for a lead that is booked/assigned but has no job yet (e.g. a service call booked with a tech).
 * Open to every staff role; RLS decides what the person may read (reps: leads they follow / clients they own).
 * The technician pill opens the assign dialog. Cancel visit clears the schedule and leaves the lead and quotes open.
 */
export default function AdminBookingDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [edit, setEdit] = useState<null | "all" | "notes">(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnToken, setReturnToken] = useState(0);
  const q = useQuery({
    queryKey: ["booking-detail", leadId], enabled: !!leadId,
    queryFn: async () => {
      const { data: l, error } = await (supabase.from("leads") as any)
        .select("id, customer_name, customer_phone, customer_address, customer_id, company_id, assigned_agent_id, scheduled_date, scheduled_time, service_type, job_types, job_info, status, lead_status, notes, latitude, longitude")
        .eq("id", leadId!).maybeSingle();
      if (error) throw error;
      if (!l) return null;
      const [{ data: sched }, { data: job }] = await Promise.all([
        (supabase.from("job_schedules") as any).select("agent_id, scheduled_date, start_time").eq("lead_id", l.id).order("scheduled_date", { ascending: true }).limit(1),
        (supabase.from("jobs") as any).select("id").eq("lead_id", l.id).not("status", "in", "(cancelled,canceled)").order("created_at", { ascending: false }).limit(1),
      ]);
      const { data: perms } = await (supabase.rpc as any)("booking_edit_perms", { p_lead: l.id });
      let quoteQuery = (supabase.from("quotes") as any)
        .select("id, quote_number, status, lead_id, customer_id")
        .eq("company_id", l.company_id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(8);
      quoteQuery = l.customer_id
        ? quoteQuery.or(`lead_id.eq.${l.id},customer_id.eq.${l.customer_id}`)
        : quoteQuery.eq("lead_id", l.id);
      const { data: quoteRows } = await quoteQuery;
      const quotes = ((quoteRows ?? []) as BookingQuoteLink[]).filter((row) => row.id);
      const s = sched?.[0];
      const techId = l.assigned_agent_id || s?.agent_id || null;
      let techName: string | null = null;
      if (techId) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", techId).maybeSingle();
        techName = (p as any)?.full_name?.trim() || "Technician";
      }
      return { ...l, assigned_agent_id: techId, tech_name: techName, date: l.scheduled_date || s?.scheduled_date || null,
        time: l.scheduled_time || s?.start_time || null, job_id: job?.[0]?.id ?? null, perms: (perms ?? null) as BookingPerms | null, quotes };
    },
  });
  const b: any = q.data;
  useEffect(() => { if (b?.job_id) navigate(`/admin/jobs/${b.job_id}`, { replace: true }); }, [b?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!b || b.perms?.view === false) return (
    <div className="space-y-3 p-4">
      <p className="text-sm">This booking isn't available to you.</p>
      <Button variant="outline" onClick={() => navigate("/admin")}>Back to Home</Button>
    </div>
  );
  const f = editableBookingFields(b.perms);
  const confirmCancel = async (reason: CancelVisitReasonId, note: string) => {
    setCancelBusy(true);
    const { error } = await (supabase.rpc as any)("cancel_booking_visit", {
      p_lead: b.id, p_reason: reason, p_note: note || null, p_job: null,
    });
    setCancelBusy(false);
    if (error) { toast({ title: "Couldn't cancel the visit", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Visit cancelled", description: "The lead and quotes stay open. No invoice." });
    setCancelOpen(false);
    void q.refetch();
  };
  return (
    <>
      <BookingDetailView
        booking={b}
        moreOpen={moreOpen}
        onMoreOpenChange={setMoreOpen}
        cancelOpen={cancelOpen}
        cancelBusy={cancelBusy}
        onCancelOpen={setCancelOpen}
        onConfirmCancel={(reason, note) => { void confirmCancel(reason, note); }}
        onReschedule={() => setEdit("all")}
        onOpenQuote={(id) => navigate(`/admin/estimates/${id}`)}
        onReassign={() => setAssignOpen(true)}
        onEdit={() => setEdit("all")}
        onSetPin={() => setPinOpen(true)}
        onOpenClient={() => b.customer_id && navigate(`/admin/customers/${b.customer_id}`)}
        onCloseLead={() => setCloseOpen(true)}
        onReturn={() => setReturnToken((n) => n + 1)}
        confirmOpen={confirmOpen}
        onConfirmOpen={setConfirmOpen}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <BookingVisitsCard leadId={b.id} companyId={b.company_id} perms={{ admin: !!b.perms?.admin, rep: !!b.perms?.rep }}
            seed={{ date: b.date, time: b.time }} returnToken={returnToken} onSaved={() => q.refetch()} />
          <JobPhotosCard leadId={b.id} addSlot={f.any ? <AddJobPhotosButton leadId={b.id} defaultType="site" /> : null} />
        </div>
      </BookingDetailView>
      {edit && <EditBookingSheet key={edit} open onOpenChange={(o) => !o && setEdit(null)} notesOnly={edit === "notes"} perms={b.perms}
        booking={{ id: b.id, date: b.scheduled_date ?? b.date, time: b.scheduled_time ?? b.time, notes: b.notes ?? null, service_type: b.service_type, customer_address: b.customer_address }}
        onSaved={() => q.refetch()} />}
      {pinOpen && <SetPinDialog open onClose={() => setPinOpen(false)} leadId={b.id} lat={b.latitude} lng={b.longitude} notes={b.notes}
        address={b.customer_address} canSetAddress={!!b.perms?.admin} onSaved={() => q.refetch()} />}
      <LeadAssignDialog leadId={assignOpen ? b.id : null} onClose={() => { setAssignOpen(false); q.refetch(); }} />
      {closeOpen && (
        <LeadCloseActions lead={b} forceOpen hideTrigger onForceClose={() => setCloseOpen(false)} onDone={() => q.refetch()} />
      )}
    </>
  );
}
