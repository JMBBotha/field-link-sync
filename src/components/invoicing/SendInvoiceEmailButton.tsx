import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Mail, Pencil, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Preview { to: string | null; accounts_copy: string | null; subject: string; html: string }

/**
 * oneinv (Johan 2026-10-16): nothing goes to a client without approval. Draft invoice →
 * "Preview & email" shows exactly the email the server will send (same builder), who gets it
 * (client + the company's accounts mailbox copy), then Send or Edit.
 */
export default function SendInvoiceEmailButton({ invoiceId, status, onEdit, onSent, className }: {
  invoiceId: string; status?: string | null; onEdit?: () => void; onSent?: () => void; className?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  if (status !== "draft") return null;

  const openPreview = async () => {
    setOpen(true); setLoading(true); setPreview(null);
    const { data, error } = await (supabase.rpc as any)("invoice_email_preview", { p_invoice_id: invoiceId });
    setLoading(false);
    if (error) { toast({ title: "Could not build the email preview", description: error.message, variant: "destructive" }); setOpen(false); return; }
    setPreview(data as Preview);
  };

  const send = async () => {
    setSending(true);
    const { error } = await supabase.from("invoices").update({ status: "sent", updated_at: new Date().toISOString() } as any).eq("id", invoiceId);
    setSending(false);
    if (error) { toast({ title: "Not sent", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Invoice emailed ✅", description: preview?.to ? `Sent to ${preview.to}` : undefined });
    setOpen(false); onSent?.();
  };

  return (
    <>
      <Button className={className} onClick={openPreview}>
        <Mail className="h-4 w-4 mr-2" /> Preview &amp; email to client
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col">
          <DialogHeader><DialogTitle>Check before sending</DialogTitle></DialogHeader>
          {loading || !preview ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-2 text-sm min-h-0 flex-1 flex flex-col">
              <p><span className="text-muted-foreground">To:</span> {preview.to || <span className="text-destructive">no client email on this invoice</span>}</p>
              {preview.accounts_copy && <p><span className="text-muted-foreground">Copy to:</span> {preview.accounts_copy}</p>}
              <p><span className="text-muted-foreground">Subject:</span> {preview.subject}</p>
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="w-full flex-1 min-h-[360px] rounded border bg-white" />
              <p className="text-xs text-muted-foreground">Use the PDF button on the invoice to check the PDF. Nothing is sent until you press Send.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); onEdit?.(); }}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
            <Button onClick={send} disabled={sending || !preview?.to}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
