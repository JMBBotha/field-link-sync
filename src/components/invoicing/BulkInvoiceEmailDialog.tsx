import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  bulkInvoicePreview,
  validRecipient,
  type BulkInvoiceRow,
} from "@/lib/bulkInvoiceEmail";

export interface BulkEmailAttachment { filename: string; content: string }

export interface BulkEmailRequest {
  ids: string[];
  to: string;
  mode: "preview" | "send";
  attachment?: BulkEmailAttachment | null;
}

export interface BulkEmailResult {
  ok?: boolean;
  to?: string;
  subject?: string;
  html?: string;
  reason?: string;
  from_email?: string | null;
  from_name?: string | null;
  sent_at?: string;
  email_count?: number;
  invoices?: Array<{ id?: string; invoice_number?: string }>;
  excluded?: Array<{ reason?: string }>;
  needs_email?: boolean;
}

/** One call to send_invoices_email. The server posts a single transactional email. */
export async function sendInvoicesEmail(input: BulkEmailRequest): Promise<BulkEmailResult> {
  const { data, error } = await (supabase.rpc as any)("send_invoices_email", {
    p_ids: input.ids,
    p_to: input.to.trim() || null,
    p_mode: input.mode,
    p_attachment: input.attachment || null,
  });
  if (error) throw error;
  return (data || {}) as BulkEmailResult;
}

/**
 * Check-before-sending dialog for several invoices. Nothing is emailed until Send.
 * Pass sender and buildAttachment in tests and the demo harness so no mail leaves.
 */
export default function BulkInvoiceEmailDialog({
  open,
  onOpenChange,
  rows,
  companyName,
  excludedNote,
  onSent,
  sender = sendInvoicesEmail,
  buildAttachment,
  localOnly = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkInvoiceRow[];
  companyName: string;
  excludedNote?: string | null;
  onSent?: () => void;
  sender?: (input: BulkEmailRequest) => Promise<BulkEmailResult>;
  buildAttachment?: (ids: string[]) => Promise<BulkEmailAttachment>;
  /** Demo harness: show the preview and never call the server. */
  localOnly?: boolean;
}) {
  const local = bulkInvoicePreview(rows, companyName);
  const [to, setTo] = useState(local.to);
  const [subject, setSubject] = useState(local.subject);
  const [html, setHtml] = useState(local.html);
  const [fromLine, setFromLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(excludedNote || null);
  const [sent, setSent] = useState<{ to: string; at: string; numbers: string } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(localOnly);
  const [includedIds, setIncludedIds] = useState<string[]>(rows.map((row) => row.id));
  const lock = useRef(false);
  const senderRef = useRef(sender);
  senderRef.current = sender;
  const ids = rows.map((row) => row.id).join(",");

  useEffect(() => {
    if (!open) return;
    const next = bulkInvoicePreview(rows, companyName);
    setTo(next.to);
    setSubject(next.subject);
    setHtml(next.html);
    setFromLine("");
    setSent(null);
    setBlocked(false);
    setIncludedIds(rows.map((row) => row.id));
    setProblem(excludedNote || null);
    if (localOnly || !rows.length) { setReady(true); return; }
    let cancelled = false;
    setReady(false);
    setBusy(true);
    senderRef.current({ ids: rows.map((row) => row.id), to: next.to, mode: "preview" })
      .then((data) => {
        if (cancelled) return;
        if (data && data.ok === false) {
          setBlocked(true);
          setProblem(data.reason || "These invoices cannot be emailed together.");
          return;
        }
        const serverIds = (data?.invoices || []).map((row) => row.id).filter((id): id is string => !!id);
        if (serverIds.length) {
          setIncludedIds(serverIds);
          setBlocked(serverIds.length < 2);
        }
        if (data?.to) setTo(data.to);
        if (data?.subject) setSubject(data.subject);
        if (data?.html) setHtml(data.html);
        const from = [data?.from_name, data?.from_email ? `<${data.from_email}>` : ""].filter(Boolean).join(" ");
        setFromLine(from);
        const extra = (data?.excluded || []).map((e) => e.reason).filter(Boolean).join(" ");
        setProblem(extra || excludedNote || null);
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) setProblem(err?.message || "Could not build the email");
      })
      .finally(() => { if (!cancelled) { setBusy(false); setReady(true); } });
    return () => { cancelled = true; };
  }, [open, ids, companyName, excludedNote, localOnly]);

  const send = async () => {
    if (lock.current || !validRecipient(to)) return;
    lock.current = true;
    setBusy(true);
    setProblem(excludedNote || null);
    try {
      const attachment = buildAttachment ? await buildAttachment(includedIds) : null;
      if (localOnly) {
        setSent({ to: to.trim(), at: new Date().toISOString(), numbers: rows.map((row) => row.invoice_number).join(", ") });
        return;
      }
      const data = await sender({ ids: includedIds, to: to.trim(), mode: "send", attachment });
      if (data?.ok === false) {
        setProblem(data.reason || "Email not sent");
        return;
      }
      const numbers = (data?.invoices || []).map((row) => row.invoice_number).filter(Boolean).join(", ")
        || rows.map((row) => row.invoice_number).join(", ");
      setSent({ to: data?.to || to.trim(), at: data?.sent_at || new Date().toISOString(), numbers });
      onSent?.();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Email not sent");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };

  const at = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sent ? "Email sent" : "Check the email"}</DialogTitle>
          <DialogDescription>
            {sent
              ? (localOnly ? "Demo only. No email was sent." : "One email was sent. Each invoice is logged and marked sent.")
              : "This is what the client gets. Nothing is sent until you press Send."}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="space-y-3">
            <p data-testid="bulk-emailed" className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-base font-semibold text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{localOnly ? `Demo only. No email was sent to ${sent.to}.` : `Emailed ${sent.numbers} to ${sent.to} at ${at(sent.at)}`}</span>
            </p>
            <Button className="min-h-11 w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {problem && <p className="break-words rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="bulk-email-problem">{problem}</p>}
            <div className="space-y-1.5">
              <label htmlFor="bulk-email-to" className="text-sm font-medium">Email to</label>
              <Input id="bulk-email-to" data-testid="bulk-email-to" type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className="h-11" />
            </div>
            <div className="rounded-lg border bg-muted/40 p-2 text-sm">
              <p className="break-words" data-testid="bulk-email-from"><span className="text-muted-foreground">From: </span>{fromLine || "the company's configured sender"}</p>
              <p className="break-words" data-testid="bulk-email-subject"><span className="text-muted-foreground">Subject: </span>{subject}</p>
              <p className="text-muted-foreground">Attachment: one PDF of these invoices</p>
            </div>
            <iframe title="Email preview" data-testid="bulk-email-frame" srcDoc={html} sandbox="" className="h-[40vh] min-h-[180px] w-full rounded-lg border bg-white" />
            <DialogFooter className="flex-row gap-2 sm:gap-2">
              <Button variant="outline" className="min-h-11 flex-1" disabled={busy} onClick={() => onOpenChange(false)}>Back</Button>
              <Button data-testid="bulk-email-send" disabled={busy || !ready || blocked || !validRecipient(to) || includedIds.length < 2} className="min-h-11 flex-1 bg-[#C2410C] text-white hover:bg-[#9A3412]" onClick={send}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
