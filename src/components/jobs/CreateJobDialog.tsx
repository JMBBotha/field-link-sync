import { useState, useEffect } from "react";
import { doneToast, doneMessage } from "@/lib/doneToast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { BookJobForm, type PastDraft, type VisitView } from "@/components/jobs/BookJobForm";
import { jobTypeFor, isAcceptedQuote, quoteStatus, type JobKind } from "@/lib/jobTypeChoice";
import { useRole } from "@/hooks/useRole";
import { useProjects, db as projectDb, clientName } from "@/hooks/useProjectTracker";
import { useBookingTechnicians } from "@/hooks/useBookingTechnicians";
import {
  canLogPastWork, customLabelMissing, houseAttachPlan, includesFirstFix, johannesburgToday, kindsFromStored, pastDateAllowed, titleDefault, workCards,
  type Doing, type HouseJobRef, type VisitKind, type WhereMode,
} from "@/lib/bookJobPath";
import { bookUpcomingOnJob, correctPastVisit, logPastVisit } from "@/lib/bookJobSave";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, AlertTriangle, CheckCircle2 } from "lucide-react";
import LocationPicker from "@/components/LocationPicker";
import { geocodeAddress } from "@/lib/geocodeAddress";
import { useClashGuard } from "@/components/scheduling/ClashGuard";
import { defaultMinutes, fromMinutes, toMinutes } from "@/lib/schedulingDefaults";
import { useQuoteLabourMinutes } from "@/hooks/useQuoteLabourMinutes";
import { formatDuration } from "@/lib/durationOptions";
import AppointmentPicker, { type AppointmentValue } from "@/components/scheduling/AppointmentPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultLeadId?: string;
  defaultQuoteId?: string;
  defaultCustomerId?: string;
}

const CreateJobDialog = ({ open, onOpenChange, defaultLeadId, defaultQuoteId, defaultCustomerId }: Props) => {
  const { companyId } = useUserCompanyId();
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { confirmBooking, flushOverride, dialog: clashDialog } = useClashGuard();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId || "");
  const [leadId, setLeadId] = useState(defaultLeadId || "");
  const [quoteId, setQuoteId] = useState(defaultQuoteId || "");
  const [locationId, setLocationId] = useState<string>("");
  const [address, setAddress] = useState("");
  const [appt, setAppt] = useState<AppointmentValue>(() => ({
    date: "",
    startTime: "",
    durationMinutes: defaultMinutes("service"),
    agentId: "",
  }));
  const [priority, setPriority] = useState("normal");
  // Required choice, no default. Installation is "quote" until the linked quote's status is "accepted".
  const [jobKind, setJobKind] = useState<JobKind | null>(null);
  const { data: linkedQuoteStatus } = useQuery({ queryKey: ["quote-status", quoteId], enabled: !!quoteId, queryFn: () => quoteStatus(quoteId) });
  const jobType = jobKind ? jobTypeFor(jobKind, !!quoteId && isAcceptedQuote(linkedQuoteStatus)) : "service";
  // Duration default: quote labour hours win, else 3 h for jobs / 1 h for a quote (sales) visit. Stops once the user picks a length.
  const [durationTouched, setDurationTouched] = useState(false);
  const { data: quoteMinutes } = useQuoteLabourMinutes(quoteId || null);
  const autoMinutes = quoteMinutes ?? defaultMinutes(jobType);
  useEffect(() => {
    if (!durationTouched) setAppt((a) => (a.durationMinutes === autoMinutes ? a : { ...a, durationMinutes: autoMinutes }));
  }, [autoMinutes, durationTouched]);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "ok" | "failed" | "inherited" | "pinned">("idle");
  const [showPicker, setShowPicker] = useState(true);
  const [where, setWhere] = useState<WhereMode>("single");
  const [doing, setDoing] = useState<Doing>("upcoming");
  const [projectId, setProjectId] = useState("");
  const [houseId, setHouseId] = useState("");
  const [visitKinds, setVisitKinds] = useState<VisitKind[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [addressTouched, setAddressTouched] = useState(false);
  const [past, setPast] = useState<PastDraft>({ techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false });
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [pathBusy, setPathBusy] = useState(false);
  const canLog = canLogPastWork(isAdmin);

  // Sync incoming defaults whenever the dialog opens (dialog is mounted once
  // and reused, so prop changes must be pushed into state here).
  useEffect(() => {
    if (!open) return;
    setCustomerId((prev) => prev || defaultCustomerId || "");
    setLeadId((prev) => prev || defaultLeadId || "");
    setQuoteId((prev) => prev || defaultQuoteId || "");
    setWhere("single");
    setDoing("upcoming");
    setProjectId("");
    setHouseId("");
    setVisitKinds([]);
    setCustomLabel("");
    setTitleTouched(false);
    setAddressTouched(false);
    setPast({ techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false });
    setCorrectId(null);
  }, [open, defaultCustomerId, defaultLeadId, defaultQuoteId]);

  const { data: customers = [] } = useQuery({
    queryKey: ["job-customers", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, address, latitude, longitude")
        .or("status.is.null,status.neq.archived")
        .order("name");
      return data || [];
    },
    enabled: open && !!companyId,
  });

  const { data: projects = [] } = useProjects(undefined, open && where === "project");
  const project = projects.find((p) => p.id === projectId) || null;
  const { data: houses = [] } = useQuery({
    queryKey: ["book-job-houses", projectId],
    enabled: open && where === "project" && !!projectId,
    queryFn: async () => {
      const { data, error } = await projectDb.from("project_houses").select("id, house_no").eq("project_id", projectId);
      if (error) throw error;
      return (data || []) as { id: string; house_no: string }[];
    },
  });
  const house = houses.find((h) => h.id === houseId) || null;
  const { data: houseJobs = [] } = useQuery({
    queryKey: ["book-job-house-jobs", project?.customer_id],
    enabled: open && where === "project" && !!project?.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, title, description, customer_id, job_type, quote_id, lead_id").eq("customer_id", project!.customer_id).limit(500);
      if (error) throw error;
      return (data || []) as HouseJobRef[];
    },
  });
  const attached = where === "project" && house && project ? houseAttachPlan(house, houseJobs, project.customer_id).job : null;
  const cards = workCards(doing, !!attached);

  // Load this customer's saved locations
  const { data: customerLocations = [] } = useQuery({
    queryKey: ["job-customer-locations", customerId],
    enabled: open && !!customerId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("customer_locations")
        .select("id,label,address,latitude,longitude,is_primary")
        .eq("customer_id", customerId)
        .order("is_primary", { ascending: false });
      return data || [];
    },
  });

  useEffect(() => {
    if (!open || where !== "project" || !project?.customer_id) return;
    setCustomerId(project.customer_id);
  }, [open, where, project?.customer_id]);

  useEffect(() => {
    if (!open || where !== "project" || !project || !house) return;
    if (!titleTouched) setTitle(titleDefault(project.name, house.house_no, visitKinds, customLabel));
    if (!addressTouched) setAddress(`${project.name} House ${house.house_no}`);
  }, [open, where, project, house, visitKinds, customLabel, titleTouched, addressTouched]);

  // Past and correct visits use the same technician lane as dispatch (AppointmentPicker / useLaneStaff).
  // The live-offer list also requires Available right now, so an offline tech never appears.
  const { data: pathTechs = [] } = useBookingTechnicians(companyId, open && canLog);
  const { data: pathVisits = [] } = useQuery({
    queryKey: ["backfill-list", attached?.id, "book-job"],
    enabled: open && !!attached?.id && canLog,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_backfill_list", { p_job: attached!.id });
      if (error) throw error;
      const rows = ((data as { visits?: any[] } | null)?.visits || []) as any[];
      return rows.map((v): VisitView => ({
        id: v.id, techId: v.tech_id || "", tech: v.tech || "Tech", date: String(v.work_date || "").slice(0, 10),
        arrive: String(v.start || "").slice(0, 5), leave: String(v.end || "").slice(0, 5), note: v.notes || "",
        kinds: kindsFromStored(v.visit_kinds, v.notes),
        customLabel: v.visit_custom || "",
      }));
    },
  });

  // When customer changes or locations load, auto-pick primary
  useEffect(() => {
    if (where === "project") return;
    if (!customerId || customerLocations.length === 0) return;
    if (locationId) return;
    const primary = customerLocations.find((l: any) => l.is_primary) || customerLocations[0];
    if (primary) {
      setLocationId(primary.id);
      setAddress(primary.address || "");
      if (primary.latitude != null && primary.longitude != null &&
          Number(primary.latitude) !== 0 && Number(primary.longitude) !== 0) {
        setLat(Number(primary.latitude));
        setLng(Number(primary.longitude));
        setGeoStatus("inherited");
      }
    }
  }, [customerId, customerLocations, where]);

  const applyLocation = (id: string) => {
    setLocationId(id);
    const loc = customerLocations.find((l: any) => l.id === id);
    if (!loc) return;
    setAddress(loc.address || "");
    if (loc.latitude != null && loc.longitude != null && Number(loc.latitude) !== 0) {
      setLat(Number(loc.latitude));
      setLng(Number(loc.longitude));
      setGeoStatus("inherited");
    } else {
      setLat(null); setLng(null); setGeoStatus("idle");
    }
  };

  // Preload from lead if provided
  useEffect(() => {
    if (!open || !leadId) return;
    (async () => {
      const { data } = await supabase
        .from("leads")
        .select("customer_id, customer_name, customer_address, service_type, notes, latitude, longitude, priority")
        .eq("id", leadId)
        .maybeSingle();
      if (!data) return;
      if (data.customer_id && !customerId) setCustomerId(data.customer_id);
      if (data.customer_address && !address) setAddress(data.customer_address);
      setTitle((prev) => prev || [data.service_type, data.customer_name].filter(Boolean).join(" — ") || "");
      setDescription((prev) => prev || data.notes || "");
      if (data.priority) setPriority((prev) => prev === "normal" ? data.priority : prev);
      if (data.latitude && data.longitude && Number(data.latitude) !== 0) {
        setLat(Number(data.latitude));
        setLng(Number(data.longitude));
        setGeoStatus("inherited");
      }
    })();
  }, [open, leadId]);

  // Auto-fill address + inherit geo when customer changes
  useEffect(() => {
    if (where === "project") return;
    if (!customerId) return;
    const cust = customers.find((c: any) => c.id === customerId);
    if (!cust) return;
    if (cust.address && !address) setAddress(cust.address);
    if (
      cust.latitude != null && cust.longitude != null &&
      Number(cust.latitude) !== 0 && Number(cust.longitude) !== 0 &&
      lat == null && lng == null
    ) {
      setLat(Number(cust.latitude));
      setLng(Number(cust.longitude));
      setGeoStatus("inherited");
    }
  }, [customerId, customers, where]);

  // Debounced geocode on address change (if we don't already have inherited coords)
  useEffect(() => {
    if (!address || address.length < 5) return;
    if (geoStatus === "inherited" || geoStatus === "pinned") return; // a pin-set address keeps its pin
    const t = setTimeout(async () => {
      setGeocoding(true);
      const r = await geocodeAddress(address);
      setGeocoding(false);
      if (r) {
        setLat(r.latitude);
        setLng(r.longitude);
        setGeoStatus("ok");
      } else {
        setGeoStatus("failed");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [address]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Final attempt to geocode if we still have no coords
      let finalLat = lat;
      let finalLng = lng;
      if (finalLat == null || finalLng == null) {
        const r = await geocodeAddress(address);
        if (r) { finalLat = r.latitude; finalLng = r.longitude; }
      }
      const userId = user?.id;

      // Verify lead still exists (it may have been converted/deleted); avoid FK violation
      let safeLeadId: string | null = leadId || null;
      if (safeLeadId) {
        const { data: leadRow } = await supabase
          .from("leads").select("id").eq("id", safeLeadId).maybeSingle();
        if (!leadRow) safeLeadId = null;
      }

      // If no location selected but we have an address, auto-create one on the customer
      let finalLocationId = locationId || null;
      if (!finalLocationId && customerId && address) {
        const { data: newLoc } = await (supabase as any)
          .from("customer_locations")
          .insert({
            customer_id: customerId,
            company_id: companyId!,
            label: "Job site",
            address,
            latitude: finalLat,
            longitude: finalLng,
            is_primary: customerLocations.length === 0,
          })
          .select("id")
          .single();
        if (newLoc) finalLocationId = newLoc.id;
      }

      const { data, error } = await (supabase as any).from("jobs").insert({
        company_id: companyId!,
        title,
        description: description || null,
        customer_id: customerId || null,
        lead_id: safeLeadId,
        quote_id: quoteId || null,
        location_id: finalLocationId,
        address: address || null,
        lat: finalLat,
        lng: finalLng,
        scheduled_for: appt.date && appt.startTime ? `${appt.date}T${appt.startTime}:00+02:00` : null,
        estimated_duration: `${(appt.durationMinutes / 60).toFixed(2)} hours`,
        priority,
        job_type: jobType,
        created_by: userId || null,
      }).select().single();
      if (error) throw error;

      // If an agent was picked, create an assignment + schedule row
      if (data?.id && appt.agentId && appt.date && appt.startTime) {
        const endTimeParts = fromMinutes(toMinutes(appt.startTime) + appt.durationMinutes);
        const { error: asgErr } = await (supabase as any).from("assignments").insert({
          job_id: data.id,
          profile_id: appt.agentId,
          assigned_by: userId || null,
          assignment_type: "internal",
          status: "accepted",
        });
        if (asgErr) throw new Error(`Job created, but assigning the person failed: ${asgErr.message}`);
        void flushOverride({ type: "job", id: data.id });
        if (safeLeadId) {
          // The assignment trigger usually creates the job-keyed row; set its times, else insert it.
          // Visits carried over from the booking (2+ rows) are kept as they are (Johan 1 Nov).
          const { data: rows } = await supabase.from("job_schedules").select("id").eq("job_id", data.id).limit(2);
          const times = { agent_id: appt.agentId, scheduled_date: appt.date, start_time: appt.startTime, end_time: endTimeParts };
          const { error: schedErr } = (rows?.length ?? 0) > 1 ? { error: null }
            : rows?.[0]
            ? await supabase.from("job_schedules").update(times).eq("id", rows[0].id)
            : await supabase.from("job_schedules").insert({ ...times, lead_id: safeLeadId, job_id: data.id } as any);
          if (schedErr) throw new Error(`Job created, but the calendar slot failed: ${schedErr.message}`);
        }
      }

      // If we have coords and the customer had none, backfill customer geo
      if (customerId && finalLat != null && finalLng != null) {
        const cust = customers.find((c: any) => c.id === customerId);
        if (cust && (!cust.latitude || Number(cust.latitude) === 0)) {
          await supabase
            .from("customers")
            .update({ latitude: finalLat, longitude: finalLng })
            .eq("id", customerId);
        }
      }
      let techName: string | null = null;
      if (appt.agentId) {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", appt.agentId).maybeSingle();
        techName = (prof as { full_name?: string | null } | null)?.full_name || null;
      }
      return { job: data, geocoded: finalLat != null, techName };
    },
    onSuccess: ({ job, geocoded, techName }) => {
      const when = job?.scheduled_for ? new Date(job.scheduled_for).toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }) : null;
      const what = when ? `Job booked for ${when}${techName ? ` with ${techName}` : ""}` : `Job created${techName ? ` for ${techName}` : ""}`;
      if (geocoded) doneToast(what, job?.id ? { label: "Open job", onClick: () => { window.location.assign(`/admin/jobs/${job.id}`); } } : undefined);
      else toast({ title: doneMessage(what), description: "No map pin yet. Pin it from the Map view when possible.", variant: "destructive" });
      ["jobs-list","jobs-dispatch","my-jobs","job-schedules","dispatch-leads","dispatch-schedules","dispatch-agents","admin-home-stats","jobs-kpi-stats","leads","leads-map"]
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create job", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCustomerId("");
    setLeadId("");
    setQuoteId("");
    setLocationId("");
    setAddress("");
    setAppt({ date: "", startTime: "", durationMinutes: defaultMinutes("service"), agentId: "" });
    setDurationTouched(false);
    setPriority("normal");
    setJobKind(null);
    setLat(null);
    setLng(null);
    setGeoStatus("idle");
    setShowPicker(true);
    setWhere("single");
    setDoing("upcoming");
    setProjectId("");
    setHouseId("");
    setVisitKinds([]);
    setCustomLabel("");
    setTitleTouched(false);
    setAddressTouched(false);
    setPast({ techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false });
    setCorrectId(null);
  };

  const refreshJobs = () => {
    ["jobs-list", "jobs-dispatch", "my-jobs", "job-schedules", "dispatch-leads", "dispatch-schedules", "dispatch-agents", "admin-home-stats", "jobs-kpi-stats", "leads", "leads-map", "project-detail", "projects", "backfill-list", "house-install-job", "job-detail"]
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  const savePast = async () => {
    if (!canLog || !visitKinds.length || customLabelMissing(visitKinds, customLabel) || !companyId) return;
    setPathBusy(true);
    try {
      const other = pathVisits.filter((v) => v.id !== correctId).flatMap((v) => v.kinds);
      if (doing === "correct") {
        if (!correctId || !attached?.id) throw new Error("Pick the visit to correct");
        await correctPastVisit({
          isAdmin: true, house: house ? { id: house.id } : null, visitId: correctId, jobId: attached.id, visitKinds, customLabel,
          techId: past.techId, date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, completed: past.completed, otherKinds: other,
        });
        toast({ title: "Visit updated" });
      } else {
        await logPastVisit({
          isAdmin: true, companyId, userId: user?.id ?? null,
          customerId: where === "project" ? (project?.customer_id || customerId) : customerId,
          projectName: project?.name || "Job",
          house: house ? { id: house.id, house_no: house.house_no } : null,
          existingJob: attached ? { id: attached.id } : null,
          visitKinds, customLabel, techId: past.techId, date: past.date, arrive: past.arrive, leave: past.leave, note: past.note,
          completed: past.completed, title, address, otherKinds: other,
        });
        toast({ title: "Visit recorded" });
      }
      refreshJobs();
      onOpenChange(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message, variant: "destructive" });
    } finally { setPathBusy(false); }
  };

  const saveOnExisting = async () => {
    if (!attached) return;
    setPathBusy(true);
    try {
      if (appt.agentId && appt.date && appt.startTime) {
        const ok = await confirmBooking({
          profileId: appt.agentId, date: appt.date, start: appt.startTime,
          end: fromMinutes(toMinutes(appt.startTime) + appt.durationMinutes),
          entity: { type: "job", id: attached.id },
        });
        if (!ok) return;
      }
      await bookUpcomingOnJob({
        jobId: attached.id, leadId: attached.lead_id ?? null, userId: user?.id ?? null, agentId: appt.agentId,
        date: appt.date, start: appt.startTime, end: fromMinutes(toMinutes(appt.startTime) + appt.durationMinutes),
      });
      void flushOverride({ type: "job", id: attached.id });
      toast({ title: "Booked on this house's job" });
      refreshJobs();
      onOpenChange(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Couldn't book", description: e?.message, variant: "destructive" });
    } finally { setPathBusy(false); }
  };

  const geoHint = () => {
    if (geocoding) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Locating address…</span>;
    if (geoStatus === "ok" || geoStatus === "pinned") return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Address located — will pin on Map</span>;
    if (geoStatus === "inherited") return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Using existing customer/lead coordinates</span>;
    if (geoStatus === "failed") return <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> Couldn't locate address — <button type="button" className="underline" onClick={() => setShowPicker(true)}>place pin manually</button></span>;
    return null;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book a job</DialogTitle>
          <DialogDescription>Create New Job — new work, past work, projects, and later corrections.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => { setTitleTouched(true); setTitle(e.target.value); }} placeholder="e.g. First fix — Avec House 12" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Job details..." rows={3} />
          </div>
          <BookJobForm
            where={where}
            onWhere={(w) => { setWhere(w); if (w === "single") { setProjectId(""); setHouseId(""); } }}
            doing={doing}
            onDoing={setDoing}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            projectId={projectId}
            onProject={(id) => { setProjectId(id); setHouseId(""); }}
            houses={houses}
            houseId={houseId}
            onHouse={setHouseId}
            clientLabel={where === "project" && project ? clientName(project.customers) : null}
            projectHref={project && house ? `/admin/projects/${project.id}?house=${house.id}` : null}
            attachedTitle={attached ? (attached.title || "Installation job") : null}
            cards={cards}
            jobKind={jobKind}
            onJobKind={setJobKind}
            visitKinds={visitKinds}
            customLabel={customLabel}
            onCustomLabel={setCustomLabel}
            onVisitKinds={(next) => {
              if (includesFirstFix(next) && !includesFirstFix(visitKinds)) setPast((p) => ({ ...p, completed: false }));
              setVisitKinds(next);
            }}
            canLogPast={canLog}
            techs={pathTechs}
            past={past}
            onPast={setPast}
            visits={pathVisits}
            correctId={correctId}
            onCorrect={(id) => {
              setCorrectId(id);
              const v = pathVisits.find((x) => x.id === id);
              if (!v) return;
              if (v.kinds.length) setVisitKinds(v.kinds);
              setCustomLabel(v.customLabel || "");
              setPast((p) => ({ ...p, techId: v.techId || p.techId, date: v.date || p.date, arrive: v.arrive || p.arrive, leave: v.leave, note: v.note, completed: false }));
            }}
            classic={doing !== "upcoming" ? null : (
              <div className="space-y-4">
                {where !== "project" && (
                  <div>
                    <Label>Customer <span className="text-destructive">*</span></Label>
                    <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setLocationId(""); setLat(null); setLng(null); setGeoStatus("idle"); }}>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!attached && customerId && customerLocations.length > 0 && (
                  <div>
                    <Label>Location <span className="text-muted-foreground text-xs">(pick a saved site)</span></Label>
                    <Select value={locationId} onValueChange={applyLocation}>
                      <SelectTrigger><SelectValue placeholder="Choose a saved location" /></SelectTrigger>
                      <SelectContent>
                        {customerLocations.map((l: any) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.label}{l.is_primary ? " ⭐" : ""} — {l.address}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Or type a new address below to save it as a new location for this customer.
                    </p>
                  </div>
                )}
                {!attached && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Address <span className="text-destructive">*</span></Label>
                      <Button type="button" size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setShowPicker((v) => !v)}>
                        <MapPin className="h-3 w-3" /> {showPicker ? "Hide map" : "Pin on map"}
                      </Button>
                    </div>
                    <Input
                      value={address}
                      onChange={e => { setAddressTouched(true); setAddress(e.target.value); setLocationId(""); setGeoStatus("idle"); setLat(null); setLng(null); }}
                      placeholder="Job address"
                    />
                    {geoHint()}
                    {showPicker && (
                      <div className="mt-2">
                        <LocationPicker
                          latitude={lat}
                          longitude={lng}
                          onLocationChange={(la, ln, addr) => {
                            setAddressTouched(true);
                            setLat(la); setLng(ln); setGeoStatus("pinned");
                            if (addr) setAddress(addr);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-semibold">
                      Schedule <span className="text-destructive">*</span>
                    </Label>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Date · Time · Technician
                    </span>
                  </div>
                  <AppointmentPicker value={appt} onChange={(v) => { if (v.durationMinutes !== appt.durationMinutes) setDurationTouched(true); setAppt(v); }} lat={lat} lng={lng}
                    durationHint={durationTouched ? null : quoteMinutes ? `From quote labour (${formatDuration(quoteMinutes)})` : jobType === "quote" ? "Sales visit 1 h" : "Default 3 h"} />
                </div>
                {!attached && (
                  <div>
                    <Label>Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-[#C2410C] text-white hover:bg-[#9A3412]"
            data-testid="book-job-save"
            onClick={async () => {
              if (doing === "past" || doing === "correct") { await savePast(); return; }
              if (attached) { await saveOnExisting(); return; }
              if (appt.agentId && appt.date && appt.startTime) {
                const ok = await confirmBooking({
                  profileId: appt.agentId, date: appt.date, start: appt.startTime,
                  end: fromMinutes(toMinutes(appt.startTime) + appt.durationMinutes),
                  entity: { type: "job", id: "" },
                });
                if (!ok) return;
              }
              createMutation.mutate();
            }}
            disabled={(() => {
              if (!companyId || createMutation.isPending || pathBusy) return true;
              if (doing === "past" || doing === "correct") {
                const today = johannesburgToday();
                return !canLog || !visitKinds.length || customLabelMissing(visitKinds, customLabel) || !past.techId || !past.arrive || !pastDateAllowed(past.date, today)
                  || (doing === "correct" && !correctId)
                  || (doing === "past" && where === "project" && !house)
                  || (doing === "past" && where === "single" && (!customerId || !address || !title));
              }
              if (attached) return !appt.date || !appt.startTime || !appt.agentId;
              return !jobKind || !title || !customerId || !address || !appt.date || !appt.startTime;
            })()}
          >
            {(createMutation.isPending || pathBusy) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {doing === "past" ? "Save visit" : doing === "correct" ? "Save correction" : attached ? "Book on this job" : "Create Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {clashDialog}
    </>
  );
};

export default CreateJobDialog;
