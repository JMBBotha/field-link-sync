import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2 } from "lucide-react";
import AppointmentPicker, {
  type AppointmentValue,
} from "@/components/scheduling/AppointmentPicker";
import { useAcceptLead, type AcceptLeadInput } from "@/hooks/useAcceptLead";
import { format } from "date-fns";

interface AcceptLeadDialogProps {
  lead: AcceptLeadInput | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after successful accept, with the resulting job id. */
  onDone?: (jobId: string) => void;
  /** Pre-select this agent (e.g. current user on Field Agent view). */
  defaultAgentId?: string;
}

const defaultAppointment = (): AppointmentValue => {
  const now = new Date();
  const hour = Math.min(17, now.getHours() + 1);
  return {
    date: format(now, "yyyy-MM-dd"),
    startTime: `${String(hour).padStart(2, "0")}:00`,
    durationMinutes: 120,
    agentId: "",
  };
};

const AcceptLeadDialog = ({
  lead,
  open,
  onOpenChange,
  onDone,
}: AcceptLeadDialogProps) => {
  const { acceptAndSchedule, submitting } = useAcceptLead();
  const [appt, setAppt] = useState<AppointmentValue>(defaultAppointment());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [address, setAddress] = useState("");
  const [locationId, setLocationId] = useState<string>("");

  // Reset when a new lead opens
  useEffect(() => {
    if (!open || !lead) return;
    setAppt({
      ...defaultAppointment(),
      agentId: "",
    });
    setTitle(lead.service_type || `Job for ${lead.customer_name || "customer"}`);
    setDescription(lead.notes || "");
    setPriority(lead.priority || "normal");
    setAddress(lead.customer_address || "");
    setLocationId("");
  }, [open, lead]);

  // Alternate customer locations (only shown when >1 exists)
  const { data: locations = [] } = useQuery({
    queryKey: ["customer-locations", lead?.customer_id],
    enabled: !!lead?.customer_id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_locations")
        .select("id, label, address, is_primary")
        .eq("customer_id", lead!.customer_id!)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const showLocationPicker = useMemo(() => locations.length > 1, [locations]);

  useEffect(() => {
    if (!showLocationPicker || !locations.length) return;
    if (!locationId) {
      const primary = locations.find((l: any) => l.is_primary) || locations[0];
      setLocationId(primary.id);
      if (primary.address) setAddress(primary.address);
    }
  }, [showLocationPicker, locations, locationId]);

  const handleSubmit = async () => {
    if (!lead) return;
    const finalAddress =
      showLocationPicker
        ? locations.find((l: any) => l.id === locationId)?.address || address
        : address;

    const result = await acceptAndSchedule(lead, {
      appointment: appt,
      title: title.trim() || "Untitled job",
      description: description.trim(),
      priority,
      address: finalAddress,
      locationId: showLocationPicker ? locationId : null,
    });
    if (result) {
      onOpenChange(false);
      onDone?.(result.jobId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Accept &amp; schedule
          </DialogTitle>
          <DialogDescription>
            {lead?.customer_name
              ? `Set the next steps for ${lead.customer_name}.`
              : "Set the next steps for this lead."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="accept-title">Job title</Label>
              <Input
                id="accept-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. AC service call"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="accept-desc">Notes / description</Label>
            <Textarea
              id="accept-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything the technician should know…"
            />
          </div>

          {showLocationPicker && (
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Select
                value={locationId}
                onValueChange={(v) => {
                  setLocationId(v);
                  const loc = locations.find((l: any) => l.id === v);
                  if (loc?.address) setAddress(loc.address);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label || l.address}
                      {l.is_primary ? " · primary" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!showLocationPicker && (
            <div className="space-y-1.5">
              <Label htmlFor="accept-addr">Address</Label>
              <Input
                id="accept-addr"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Job address"
              />
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <AppointmentPicker value={appt} onChange={setAppt} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling…
              </>
            ) : (
              "Accept & schedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AcceptLeadDialog;
