import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { renderBrandedEmail, paymentReminderBodyHtml, brandedTransactionalFooter, type EmailBrand, type PaymentReminderEmailData } from "@/lib/brandedEmail";

/** Build the reminder html on the shared branded template (same renderer the server uses). */
export function reminderHtml(layout: any, subject: string, message: string): string {
  return renderBrandedEmail({
    brand: layout.brand as EmailBrand, title: subject, kicker: "Payment reminder", greetingName: layout.greeting_name ?? null,
    bodyHtml: paymentReminderBodyHtml({ ...(layout.data as PaymentReminderEmailData), message }),
    footerHtml: brandedTransactionalFooter(String(layout.brand?.name || "")),
  });
}

/** Admin previews the branded reminder, can edit the words, then presses Send. Never sent automatically (Johan 31 Oct 09:58). */
export function PaymentReminderDialog({ followupId, open, onOpenChange, onSent }: { followupId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onSent?: () => void }) {
  const [pre, setPre] = useState<any>(null);
  const [subject, setSubject] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !followupId) return;
    setPre(null);
    (supabase as any).rpc("send_payment_reminder", { p_followup: followupId, p_mode: "preview" }).then(({ data, error }: any) => {
      if (error) { toast.error(error.message); onOpenChange(false); return; }
      setPre(data); setSubject(data.subject || ""); setMsg(data.message || "");
    });
  }, [open, followupId]);
  const html = useMemo(() => (pre?.layout ? reminderHtml(pre.layout, subject, msg) : ""), [pre, subject, msg]);
  const send = async () => {
    if (!window.confirm(`Send this payment reminder to ${pre?.to}? It sends once.`)) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("send_payment_reminder", { p_followup: followupId, p_mode: "send", p_html: html, p_subject: subject, p_message: msg });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Reminder emailed to ${data?.to}`); onOpenChange(false); onSent?.();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="reminder-preview">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-[#1590D6]" />Payment reminder preview</DialogTitle></DialogHeader>
        {!pre ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
          <div className="space-y-3 text-sm">
            <div className="text-muted-foreground">To <b className="text-foreground">{pre.to}</b> · nothing is sent until you press Send.</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" className="w-full rounded-lg border bg-white px-3 py-2" />
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message" rows={5} className="w-full rounded-lg border bg-white px-3 py-2" />
            <iframe title="Email preview" srcDoc={html} className="h-[520px] w-full rounded-xl border bg-[#eef3f9]" />
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => onOpenChange(false)} className="rounded-xl border bg-white px-4 py-2">Cancel</button>
              <button disabled={busy} onClick={send} className="rounded-xl bg-[#1AA7EC] px-4 py-2 font-semibold text-white">{busy ? "Sending…" : "Send reminder"}</button>
            </div>
          </div>)}
      </DialogContent>
    </Dialog>
  );
}
