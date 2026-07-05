import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
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
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

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
    durationMinutes: 120,
    agentId: "",
  }));
  const [priority, setPriority] = useState("normal");
  const [jobType, setJobType] = useState("service");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "ok" | "failed" | "inherited">("idle");
  const [showPicker, setShowPicker] = useState(false);

  // Sync incoming defaults whenever the dialog opens (dialog is mounted once
  // and reused, so prop changes must be pushed into state here).
  useEffect(() => {
    if (!open) return;
    setCustomerId((prev) => prev || defaultCustomerId || "");
    setLeadId((prev) => prev || defaultLeadId || "");
    setQuoteId((prev) => prev || defaultQuoteId || "");
  }, [open, defaultCustomerId, defaultLeadId, defaultQuoteId]);

  const { data: customers = [] } = useQuery({
    queryKey: ["job-customers", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, address, latitude, longitude")
        .order("name");
      return data || [];
    },
    enabled: open && !!companyId,
  });

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

  // When customer changes or locations load, auto-pick primary
  useEffect(() => {
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
  }, [customerId, customerLocations]);

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
  }, [customerId, customers]);

  // Debounced geocode on address change (if we don't already have inherited coords)
  useEffect(() => {
    if (!address || address.length < 5) return;
    if (geoStatus === "inherited") return;
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
        scheduled_for: appt.date && appt.startTime ? `${appt.date}T${appt.startTime}:00` : null,
        estimated_duration: `${(appt.durationMinutes / 60).toFixed(2)} hours`,
        priority,
        job_type: jobType,
        created_by: userId || null,
      }).select().single();
      if (error) throw error;

      // If an agent was picked, create an assignment + schedule row
      if (data?.id && appt.agentId && appt.date && appt.startTime) {
        const endTimeParts = (() => {
          const [h, m] = appt.startTime.split(":").map(Number);
          const total = h * 60 + m + appt.durationMinutes;
          const eh = Math.floor(total / 60) % 24;
          const em = total % 60;
          return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
        })();
        await (supabase as any).from("assignments").insert({
          job_id: data.id,
          profile_id: appt.agentId,
          assigned_by: userId || null,
          assignment_type: "primary",
          status: "assigned",
        });
        if (safeLeadId) {
          await supabase.from("job_schedules").insert({
            lead_id: safeLeadId,
            agent_id: appt.agentId,
            scheduled_date: appt.date,
            start_time: appt.startTime,
            end_time: endTimeParts,
          });
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
      return { job: data, geocoded: finalLat != null };
    },
    onSuccess: ({ geocoded }) => {
      toast({
        title: "Job created",
        description: geocoded
          ? "Now visible in Dispatch, Schedule, My Jobs and Map."
          : "Created without map coordinates — pin it from the Map view when possible.",
        variant: geocoded ? "default" : "destructive",
      });
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
    setAppt({ date: "", startTime: "", durationMinutes: 120, agentId: "" });
    setPriority("normal");
    setJobType("service");
    setLat(null);
    setLng(null);
    setGeoStatus("idle");
    setShowPicker(false);
  };

  const geoHint = () => {
    if (geocoding) return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Locating address…</span>;
    if (geoStatus === "ok") return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Address located — will pin on Map</span>;
    if (geoStatus === "inherited") return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Using existing customer/lead coordinates</span>;
    if (geoStatus === "failed") return <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> Couldn't locate address — <button type="button" className="underline" onClick={() => setShowPicker(true)}>place pin manually</button></span>;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>Fill in the job details below</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AC Installation - Unit 3" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Job details..." rows={3} />
          </div>
          <div>
            <Label>Job Type</Label>
            <Select value={jobType} onValueChange={setJobType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="installation">Installation</SelectItem>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="repair">Repair</SelectItem>
                <SelectItem value="survey">Survey</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          {customerId && customerLocations.length > 0 && (
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
              <p className="text-[11px] text-muted-foreground mt-1">
                Or type a new address below to save it as a new location for this customer.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Address <span className="text-destructive">*</span></Label>
              <Button type="button" size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setShowPicker((v) => !v)}>
                <MapPin className="h-3 w-3" /> {showPicker ? "Hide map" : "Pin on map"}
              </Button>
            </div>
            <Input
              value={address}
              onChange={e => { setAddress(e.target.value); setLocationId(""); setGeoStatus("idle"); setLat(null); setLng(null); }}
              placeholder="Job address"
            />
            {geoHint()}
            {showPicker && (
              <div className="mt-2">
                <LocationPicker
                  latitude={lat}
                  longitude={lng}
                  onLocationChange={(la, ln, addr) => {
                    setLat(la); setLng(ln); setGeoStatus("ok");
                    if (addr && !address) setAddress(addr);
                  }}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Scheduled Date/Time <span className="text-destructive">*</span></Label>
              <Input type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
            </div>
            <div>
              <Label>Estimated Duration (hrs)</Label>
              <Input type="number" min="0.5" step="0.5" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title || !customerId || !address || !scheduledFor || !companyId || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateJobDialog;
