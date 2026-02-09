import { useState, useEffect } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Send, Eye } from "lucide-react";
import { useInvoiceAgentContext } from "@/hooks/useInvoiceAgentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  customerEmail: string | null;
}

function buildSubject(action: string, invoiceNumber?: string, amount?: number): string {
  switch (action) {
    case "payment_reminder":
      return `Payment Reminder: Invoice #${invoiceNumber || "N/A"} – R ${(amount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;
    case "invoice_followup":
      return "Your HVAC service is complete – invoice details";
    case "thank_you":
      return "Thank you for your payment – satisfaction check";
    default:
      return "Follow-up regarding your recent service";
  }
}

function buildBody(action: string, clientName: string, invoiceNumber?: string, amount?: number, daysOverdue?: number): string {
  const greeting = `Dear ${clientName},\n\n`;
  switch (action) {
    case "payment_reminder":
      return `${greeting}This is a friendly reminder that Invoice #${invoiceNumber} for R ${(amount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })} is ${daysOverdue && daysOverdue > 0 ? `${daysOverdue} days overdue` : "due for payment"}.\n\nPlease arrange payment at your earliest convenience. If you have already made payment, please disregard this message.\n\nKind regards`;
    case "invoice_followup":
      return `${greeting}We are pleased to confirm that your HVAC service has been completed successfully.\n\nWe will be sending your invoice shortly. Please don't hesitate to contact us if you have any questions.\n\nKind regards`;
    case "thank_you":
      return `${greeting}Thank you for your recent payment. We appreciate your prompt settlement.\n\nWe hope you are satisfied with our service. Please let us know if there's anything else we can assist with.\n\nKind regards`;
    default:
      return `${greeting}We wanted to follow up regarding your recent HVAC service.\n\nKind regards`;
  }
}

const SendReminderDrawer = ({ open, onClose, leadId, customerEmail }: Props) => {
  const { data: ctx, isLoading } = useInvoiceAgentContext(leadId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachInvoice, setAttachInvoice] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (ctx) {
      setSubject(buildSubject(ctx.suggested_action, ctx.invoice?.number, ctx.invoice?.amount));
      setBody(buildBody(ctx.suggested_action, ctx.client.name, ctx.invoice?.number, ctx.invoice?.amount, ctx.invoice?.days_overdue));
      setAttachInvoice(!!ctx.invoice);
    }
  }, [ctx]);

  const handleSend = async () => {
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-reminder-email", {
        body: {
          context: ctx,
          subject,
          body,
          attach_invoice: attachInvoice,
        },
      });
      if (error) throw error;

      // Log to communication_log
      const { data: { user } } = await supabase.auth.getUser();
      if (user && ctx) {
        await supabase.from("communication_log").insert({
          lead_id: ctx.lead.id,
          agent_id: user.id,
          type: "email",
          subject,
          body,
        });
      }

      toast.success("Email sent successfully");
      onClose();
    } catch (e: any) {
      toast.error("Failed to send email", { description: e.message });
    } finally {
      setSending(false);
    }
  };

  const handlePreview = () => {
    const html = `<html><body style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto"><h2>${subject}</h2><pre style="white-space:pre-wrap;font-family:inherit">${body}</pre></body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const noEmail = !customerEmail;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Send Reminder Email
          </DrawerTitle>
          <DrawerDescription>
            {noEmail ? "No email address on file for this client" : `To: ${customerEmail}`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-4 overflow-y-auto">
          {isLoading || !ctx ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="email-subject" className="text-xs">Subject</Label>
                <Input
                  id="email-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={noEmail}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email-body" className="text-xs">Body</Label>
                <Textarea
                  id="email-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  disabled={noEmail}
                />
              </div>

              {ctx.invoice && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="attach-invoice"
                    checked={attachInvoice}
                    onCheckedChange={(v) => setAttachInvoice(!!v)}
                    disabled={noEmail}
                  />
                  <Label htmlFor="attach-invoice" className="text-xs cursor-pointer">
                    Attach invoice PDF
                  </Label>
                </div>
              )}
            </>
          )}
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button onClick={handleSend} disabled={sending || noEmail || !ctx} className="flex-1 gap-2">
            <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send Email"}
          </Button>
          <Button variant="outline" onClick={handlePreview} disabled={noEmail || !ctx} className="gap-2">
            <Eye className="h-4 w-4" /> Preview
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default SendReminderDrawer;
