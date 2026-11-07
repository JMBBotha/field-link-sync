/**
 * Booking confirmation by EMAIL (Johan 14:45): existing send-transactional-email via send_booking_confirmation.
 * Service / repair bookings carry the R680 excl. VAT call-out line. Office previews, can change the address, then sends.
 * Never automatic. SMS later; WhatsApp stays off.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { previewBookingEmail, sendBookingEmail, type BookingPreview } from "@/lib/jobTypeChoice";
import { bookingSendPayload, canSendEditedEmail, htmlToPlainMessage, plainMessageToEmailHtml } from "@/lib/sendPreviewEdit";

export default function BookingConfirmationEmail({ jobId, disabled }: { jobId: string; disabled?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pre, setPre] = useState<BookingPreview | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const originalBody = useMemo(() => (pre ? htmlToPlainMessage(pre.html) : ""), [pre]);
  const openIt = async () => {
    setBusy(true);
    try {
      const p = await previewBookingEmail(jobId);
      setPre(p); setTo(p.to || ""); setSubject(p.subject || ""); setBody(htmlToPlainMessage(p.html)); setOpen(true);
    }
    catch (e) { toast({ title: "Can't email the booking", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!pre || !canSendEditedEmail(subject, body)) return;
    setBusy(true);
    try {
      const edit = bookingSendPayload(jobId, to, subject, body, { subject: pre.subject || "", body: originalBody });
      const r = await sendBookingEmail(jobId, to, { subject: edit.p_subject, body: edit.p_body });
      toast({ title: `Booking confirmation emailed to ${r.to}` }); setOpen(false);
    }
    catch (e) { toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const previewHtml = pre && (subject.trim() !== (pre.subject || "").trim() || body.trim() !== originalBody.trim())
    ? plainMessageToEmailHtml(body) : (pre?.html || "");
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={openIt} data-testid="booking-email-open">✉️ Email booking confirmation</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Email booking confirmation</DialogTitle></DialogHeader>
          {pre && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="booking-email-subject" className="text-sm font-medium">Subject</label>
                <Input id="booking-email-subject" data-testid="booking-email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="booking-email-body" className="text-sm font-medium">Message</label>
                <Textarea id="booking-email-body" data-testid="booking-email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border p-2 text-sm" data-testid="booking-email-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Client email" aria-label="Send to" />
              <Button className="w-full" disabled={busy || !/^\S+@\S+\.\S+$/.test(to) || !canSendEditedEmail(subject, body)} onClick={send} data-testid="booking-email-send">Send email</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
