import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, HandCoins, Mail, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatRand } from "@/utils/formatRand";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
type Row = { id: string; customer_name: string | null; customer_phone: string | null; invoice_number: string | null; amount_due: number; due_date: string | null;
  days_late: number | null; stage: number; status: string; proposed_message: string; approved_message: string | null; subject?: string | null; created_at: string; decided_at: string | null; sent_at: string | null };

const STATUS: Record<string, string> = { pending: "Waiting for owner", approved: "Approved", declined: "Declined", sent: "Sent", cancelled: "Cancelled" };

/** Owner-approved payment follow-ups. Nothing goes to a client without the owner's approval for that client (DB-enforced). */
export default function AdminPaymentFollowupsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [send, setSend] = useState<Row | null>(null);
  const { data: owner } = useQuery({ queryKey: ["is-my-company-owner"], queryFn: async () => (await db.rpc("is_my_company_owner")).data === true });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payment-followups"],
    queryFn: async () => {
      const { data, error } = await db.from("payment_followups").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as Row[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["payment-followups"] });

  const decide = async (r: Row, approve: boolean) => {
    const { error } = await db.rpc("pf_decide", { p_id: r.id, p_approve: approve, p_message: edit[r.id] ?? null });
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: approve ? "Approved" : "Declined", description: approve ? `A reminder to ${r.customer_name} can now be sent once.` : "Nothing will be sent." });
    refresh();
  };

  const doSend = async (r: Row) => {
    const { data, error } = await supabase.functions.invoke("send-reminder-email", { body: { followup_id: r.id } });
    if (error || !data?.success) toast({ title: "Not sent", description: (data as any)?.error || error?.message || "Email failed", variant: "destructive" });
    else toast({ title: "Email sent", description: `Reminder emailed to ${data.sentTo}.` });
    setSend(null); refresh();
  };

  const open = rows.filter((r) => r.status === "pending" || r.status === "approved");
  const done = rows.filter((r) => !(r.status === "pending" || r.status === "approved"));

  const card = (r: Row) => (
    <Card key={r.id} data-testid="pf-row">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">{r.customer_name}</div>
            <div className="text-xs text-muted-foreground">Invoice {r.invoice_number} · {formatRand(Number(r.amount_due))} outstanding{r.days_late != null ? ` · ${r.days_late} days past due` : ""}{r.stage ? ` · flagged at ${r.stage} days` : " · asked by staff"}</div>
          </div>
          <Badge variant={r.status === "approved" ? "default" : "secondary"}>{STATUS[r.status] || r.status}</Badge>
        </div>
        {r.status === "pending" ? (
          <>
            <Textarea rows={3} value={edit[r.id] ?? r.proposed_message} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} disabled={!owner} />
            {owner ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide(r, true)}><CheckCircle2 className="mr-1 h-4 w-4" />Approve this reminder</Button>
                <Button size="sm" variant="outline" onClick={() => decide(r, false)}><XCircle className="mr-1 h-4 w-4" />Decline</Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Only the company owner can approve or decline this.</p>}
          </>
        ) : (
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{r.subject ? <b className="block">{r.subject}</b> : null}{r.approved_message || r.proposed_message}</p>
        )}
        {r.status === "approved" && (
          <Button size="sm" variant="secondary" onClick={() => setSend(r)}><Mail className="mr-1 h-4 w-4" />Send email</Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="payment-followups">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><HandCoins className="h-5 w-5" />Payment follow-ups</h1>
        <p className="text-sm text-muted-foreground">Final invoices get a friendly draft 3 days before the due date, on the due day, and 3 and 7 days after; at 14 days the owner phones the client. Nothing is sent until the owner approves a reminder for that client, and each approval sends once. Keep it friendly: legal or penalty wording is blocked.</p>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : open.length ? open.map(card) : <Card><CardContent className="p-4 text-sm text-muted-foreground">Nothing waiting. No client will be chased without your approval.</CardContent></Card>}
      {!!done.length && <><h2 className="pt-2 text-sm font-medium text-muted-foreground">History</h2>{done.slice(0, 20).map(card)}</>}
      <Dialog open={!!send} onOpenChange={(o) => !o && setSend(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send this?</DialogTitle><DialogDescription>Email to {send?.customer_name}. This approval can be used once.</DialogDescription></DialogHeader>
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{send?.approved_message}</p>
          <DialogFooter><Button variant="outline" onClick={() => setSend(null)}>Cancel</Button><Button onClick={() => send && doSend(send)}>Send</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
