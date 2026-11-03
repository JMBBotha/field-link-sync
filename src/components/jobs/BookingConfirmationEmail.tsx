/**
 * Booking confirmation by EMAIL (Johan 14:45): existing send-transactional-email via send_booking_confirmation.
 * Service / repair bookings carry the R680 excl. VAT call-out line. Office previews, can change the address, then sends.
 * Never automatic. SMS later; WhatsApp stays off.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { previewBookingEmail, sendBookingEmail, type BookingPreview } from "@/lib/jobTypeChoice";

export default function BookingConfirmationEmail({ jobId, disabled }: { jobId: string; disabled?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pre, setPre] = useState<BookingPreview | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const openIt = async () => {
    setBusy(true);
    try { const p = await previewBookingEmail(jobId); setPre(p); setTo(p.to || ""); setOpen(true); }
    catch (e) { toast({ title: "Can't email the booking", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try { const r = await sendBookingEmail(jobId, to); toast({ title: `Booking confirmation emailed to ${r.to}` }); setOpen(false); }
    catch (e) { toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={openIt} data-testid="booking-email-open">✉️ Email booking confirmation</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Email booking confirmation</DialogTitle></DialogHeader>
          {pre && (
            <div className="space-y-3">
              <div className="text-sm"><b>Subject:</b> {pre.subject}</div>
              <div className="max-h-64 overflow-auto rounded-lg border p-2 text-sm" data-testid="booking-email-preview" dangerouslySetInnerHTML={{ __html: pre.html }} />
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Client email" aria-label="Send to" />
              <Button className="w-full" disabled={busy || !/^\S+@\S+\.\S+$/.test(to)} onClick={send} data-testid="booking-email-send">Send email</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
