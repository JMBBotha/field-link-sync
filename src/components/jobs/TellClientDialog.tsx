/**
 * "Tell client" (phase a2): the office edits a draft and approves it. Nothing is sent until "Approve & send" is pressed.
 * Email goes through the existing send-transactional-email function (from the DB, no new edge function).
 * SMS opens the office phone's SMS app with the approved text (the app has no SMS provider). Never WhatsApp.
 */
import { useEffect, useState } from "react";
import { Mail, MessageSquare, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { looksLikeEmail, smsHref, type ClientChannel } from "@/lib/jobWatch";

type Draft = { id: string; channel: ClientChannel; to_address: string | null; subject: string | null; body: string; status: string };

type Props = { open: boolean; onOpenChange: (v: boolean) => void; jobId: string; alertId?: string | null; title?: string };

export default function TellClientDialog({ open, onOpenChange, jobId, alertId, title }: Props) {
  const [channel, setChannel] = useState<ClientChannel>("email");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (supabase.rpc as any)("draft_client_job_message", { p_job_id: jobId, p_channel: channel, p_alert_id: alertId ?? null })
      .then(({ data, error }: any) => {
        if (cancelled) return;
        setLoading(false);
        if (error) { toast.error("Could not prepare the message: " + error.message); return; }
        const d = (Array.isArray(data) ? data[0] : data) as Draft;
        setDraft(d); setTo(d?.to_address ?? ""); setSubject(d?.subject ?? ""); setBody(d?.body ?? "");
      });
    return () => { cancelled = true; };
  }, [open, channel, jobId, alertId]);

  const toOk = channel === "email" ? looksLikeEmail(to) : to.replace(/[^\d]/g, "").length >= 9;
  const canSend = !!draft && !loading && !sending && toOk && body.trim().length > 0;

  const approve = async () => {
    if (!draft) return;
    setSending(true);
    const { error } = await (supabase.rpc as any)("approve_client_job_message", { p_id: draft.id, p_to: to, p_subject: channel === "email" ? subject : null, p_body: body });
    setSending(false);
    if (error) return toast.error(error.message);
    if (channel === "sms") {
      window.location.href = smsHref(to, body);
      toast.success("Opening your SMS app – press send there");
    } else {
      toast.success("Email sent to the client");
    }
    onOpenChange(false);
  };
  const discard = async () => {
    if (draft) await (supabase.rpc as any)("discard_client_job_message", { p_id: draft.id });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6" data-testid="tell-client">
        <DialogHeader>
          <DialogTitle>Tell the client</DialogTitle>
          <DialogDescription>{title ? `“${title}”. ` : ""}Check and edit the message. Nothing is sent until you approve it.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Send by" className="grid grid-cols-2 gap-2">
          {([["email", "Email", Mail], ["sms", "SMS", MessageSquare]] as const).map(([c, label, Icon]) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}
              className={cn("flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 text-sm font-semibold",
                channel === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
              data-testid={`tell-client-${c}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">{channel === "email" ? "Client email" : "Client mobile"}
            <Input className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} inputMode={channel === "email" ? "email" : "tel"} disabled={loading} />
          </label>
          {channel === "email" && (
            <label className="block text-sm font-medium">Subject
              <Input className="mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={loading} />
            </label>
          )}
          <label className="block text-sm font-medium">Message
            <Textarea className="mt-1 min-h-[150px] text-base" value={loading ? "Preparing draft…" : body} onChange={(e) => setBody(e.target.value)} disabled={loading} data-testid="tell-client-body" />
          </label>
          {body.includes("[time]") && <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Replace [time] with the expected arrival before sending.</p>}
          <p className="text-xs text-muted-foreground">
            {channel === "email" ? "Sent from the app's email, signed by you." : "Opens the SMS app on this device with the text filled in. You press send."}
          </p>
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={discard} className="min-h-[44px]"><Trash2 className="mr-1 h-4 w-4" />Discard</Button>
          <Button onClick={approve} disabled={!canSend || body.includes("[time]")} className="min-h-[44px]" data-testid="tell-client-approve">
            <Send className="mr-1 h-4 w-4" />{sending ? "Sending…" : channel === "email" ? "Approve & send email" : "Approve & open SMS"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
