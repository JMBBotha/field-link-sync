import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import BotLoginCard from "@/components/supplierDocs/BotLoginCard";

const sb = supabase as any;

type Proposal = {
  id: string; action_type: string; summary: string; reason: string | null; checked_note: string | null;
  status: string; created_at: string; reviewed_at: string | null; review_note: string | null; result: any;
};

const ACTION_LABEL: Record<string, string> = {
  invoice_send: "Send invoice", invoice_void: "Void invoice", bank_unmatch: "Undo bank match", bank_ignore: "Ignore bank line",
  bank_new_expense: "Book bank line as expense", customer_set_rep: "Change client rep", payment_cancel: "Cancel payment",
  catalogue_price_change: "Price / catalogue change", stock_adjust: "Stock adjustment", user_role_change: "User or role change",
  email_supplier: "Email a supplier", email_client: "Email a client", delete_record: "Delete a record", other: "Other",
};
// Approve on these only records the OK; the change itself is done by hand in the app.
const MANUAL = new Set(["catalogue_price_change", "stock_adjust", "user_role_change", "email_supplier", "email_client", "delete_record", "other"]);

function ProposalCard({ p, onDone }: { p: Proposal; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "ok" | "no">(null);
  const review = async (approve: boolean) => {
    setBusy(approve ? "ok" : "no");
    const { data, error } = await sb.rpc("review_proposed_change", { p_id: p.id, p_approve: approve, p_note: note || null });
    setBusy(null);
    if (error) return toast.error(error.message);
    if (data?.status === "failed") toast.error(`Could not apply: ${data.error}`);
    else if (data?.note) toast.success(data.note);
    else toast.success(approve ? "Approved and done" : "Rejected");
    onDone();
  };
  const pending = p.status === "pending";
  return (
    <div className="v8-card rounded-xl border bg-card p-3 space-y-2" data-testid="walda-proposal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{ACTION_LABEL[p.action_type] ?? p.action_type}{MANUAL.has(p.action_type) ? " · you do it by hand" : ""}</div>
          <div className="font-medium text-sm break-words">{p.summary}</div>
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</span>
      </div>
      {p.reason && <p className="text-sm text-foreground/80 whitespace-pre-line">Why: {p.reason}</p>}
      {p.checked_note && <p className="text-xs text-muted-foreground">✓ {p.checked_note}</p>}
      {pending ? (
        <>
          <Textarea rows={1} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="text-sm" />
          <div className="flex gap-2">
            <Button className="flex-1" size="sm" disabled={!!busy} onClick={() => review(true)} data-testid="walda-approve"><Check className="h-4 w-4 mr-1" />{busy === "ok" ? "Working…" : "Approve"}</Button>
            <Button className="flex-1" size="sm" variant="outline" disabled={!!busy} onClick={() => review(false)} data-testid="walda-reject"><X className="h-4 w-4 mr-1" />Reject</Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {p.status === "applied" ? "Approved and done" : p.status === "approved" ? "Approved (to do by hand)" : p.status === "failed" ? `Approved but failed: ${p.result?.error ?? ""}` : "Rejected"}
          {p.reviewed_at ? ` · ${formatDistanceToNow(new Date(p.reviewed_at), { addSuffix: true })}` : ""}{p.review_note ? ` · “${p.review_note}”` : ""}
        </p>
      )}
    </div>
  );
}

/** Admin-only queue of changes WALDA (accounts bot) asked for. Approve runs as you, so the normal rules still apply. */
export default function AdminWaldaProposalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["walda-proposals", tab],
    queryFn: async () => {
      let q = sb.from("bot_proposed_changes").select("id,action_type,summary,reason,checked_note,status,created_at,reviewed_at,review_note,result");
      q = tab === "pending" ? q.eq("status", "pending").order("created_at", { ascending: true }) : q.neq("status", "pending").order("reviewed_at", { ascending: false }).limit(50);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
  });
  const done = () => { refetch(); qc.invalidateQueries({ queryKey: ["bot-proposal-count"] }); };
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><Bot className="h-5 w-5" /> WALDA approvals</h1>
      <p className="text-xs text-muted-foreground">Changes WALDA wants to make but may not do alone. Approve runs it as you, with the normal checks. She can never approve her own.</p>
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>Waiting</Button>
        <Button size="sm" variant={tab === "done" ? "default" : "outline"} onClick={() => setTab("done")}>History</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : data.length ? <div className="grid gap-2 md:grid-cols-2">{data.map((p) => <ProposalCard key={p.id} p={p} onDone={done} />)}</div>
        : <p className="text-sm text-muted-foreground">{tab === "pending" ? "Nothing waiting. WALDA is all caught up." : "No reviewed items yet."}</p>}
      <BotLoginCard />
    </div>
  );
}
