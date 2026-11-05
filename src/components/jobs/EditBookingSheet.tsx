import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { bookingPatch, editableBookingFields, type BookingPerms } from "@/lib/bookingEdit";

type B = { id: string; date: string | null; time: string | null; notes: string | null; service_type: string | null; customer_address: string | null };

/** Edit a booking (lead without a job). Admin/linked admin: everything; the client's rep: date, time, notes. Saved + logged by update_booking_details. */
export default function EditBookingSheet({ open, onOpenChange, booking, perms, onSaved, notesOnly }: {
  open: boolean; onOpenChange: (o: boolean) => void; booking: B; perms: BookingPerms | null; onSaved: () => void; notesOnly?: boolean;
}) {
  const f = editableBookingFields(perms);
  const { toast } = useToast();
  const [date, setDate] = useState(booking.date ?? "");
  const [time, setTime] = useState((booking.time ?? "").slice(0, 5));
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [service, setService] = useState(booking.service_type ?? "");
  const [address, setAddress] = useState(booking.customer_address ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const patch = bookingPatch(perms, { date: booking.date, time: booking.time, notes: booking.notes, service: booking.service_type, address: booking.customer_address },
      { date, time, notes, service, address });
    if (!Object.keys(patch).length) { onOpenChange(false); return; }
    setSaving(true);
    const { error } = await supabase.rpc("update_booking_details", { p_lead: booking.id, ...patch });
    setSaving(false);
    if (error) { toast({ title: error.message || "Couldn't save", variant: "destructive" }); return; }
    toast({ title: "Saved" }); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="edit-booking-sheet">
        <DialogHeader><DialogTitle>{notesOnly ? "Job notes" : "Edit booking"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!notesOnly && f.date && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-sm"><span className="block">Date</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="eb-date" className="min-h-11" /></label>
              <label className="block space-y-1 text-sm"><span className="block">Time</span><TimeInput24 id="eb-time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="eb-time" className="min-h-11" /></label>
            </div>
          )}
          {!notesOnly && f.service && <label className="block text-sm">Service<Input value={service} onChange={(e) => setService(e.target.value)} data-testid="eb-service" className="min-h-11" /></label>}
          {!notesOnly && f.address && <label className="block text-sm">Address<Input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="eb-address" className="min-h-11" /></label>}
          {f.notes && <label className="block text-sm">Job notes<Textarea rows={notesOnly ? 6 : 4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What the tech should know…" data-testid="eb-notes" autoFocus={notesOnly} /></label>}
          {!notesOnly && !f.service && <p className="text-xs text-muted-foreground">You can change the date, time and notes. Ask an admin to change the service or address.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="min-h-11 bg-[#1590D6]" disabled={saving} onClick={save} data-testid="eb-save">{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
