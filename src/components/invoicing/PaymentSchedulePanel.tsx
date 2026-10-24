/** Invoice payment dates (Johan 24 Oct): expected deposit + final payment, each with paid / outstanding derived from payments. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatRand } from "@/utils/formatRand";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export type PaySchedule = {
  has_deposit: boolean; deposit_amount: number; deposit_date: string | null; deposit_date_auto: boolean; deposit_paid: number; deposit_outstanding: number; deposit_status: string;
  final_amount: number; final_date: string | null; final_date_auto: boolean; final_after_days: number; final_paid: number; final_outstanding: number; final_status: string;
  terms_days: number; can_edit: boolean;
};
export const STATUS_LABEL: Record<string, string> = { paid: "Paid", part_paid: "Part paid", outstanding: "Outstanding", overdue: "Overdue", not_sent: "Not sent yet", void: "Void", none: "No deposit", unscheduled: "Unscheduled" };
const TONE: Record<string, string> = { paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", overdue: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300", part_paid: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
export const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "-");
export const addDaysIso = (d: string, n: number) => { const [y, m, dd] = d.split("-").map(Number); const x = new Date(y, m - 1, dd + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const PICKS = [30, 60, 90];

function Row({ label, amount, date, auto, paid, outstanding, status }: { label: string; amount: number; date: string | null; auto: boolean; paid: number; outstanding: number; status: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" data-testid={`pay-row-${label.toLowerCase()}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label} · {formatRand(amount)}</p>
        <p className="text-xs text-muted-foreground">{date ? `Expected ${fmtDate(date)}${auto ? " (auto)" : ""}` : "Date not set · not in the dated forecast"}{paid > 0 && status !== "paid" ? ` · ${formatRand(paid)} paid, ${formatRand(outstanding)} to come` : ""}</p>
      </div>
      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", TONE[status] || "bg-[#E8F6FE] text-[#1590D6] dark:bg-sky-500/15 dark:text-sky-300")}>{STATUS_LABEL[status] || status}</span>
    </div>
  );
}

export default function PaymentSchedulePanel({ invoiceId, refreshKey }: { invoiceId: string; refreshKey?: unknown }) {
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery({
    queryKey: ["invoice-pay-schedule", invoiceId, refreshKey],
    queryFn: async () => { const { data, error } = await sb.rpc("invoice_payment_schedule", { p_invoice: invoiceId }); if (error) throw error; return ((data || [])[0] || null) as PaySchedule | null; },
  });
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [dep, setDep] = useState(""); const [days, setDays] = useState<number>(30); const [custom, setCustom] = useState(false); const [unset, setUnset] = useState(false); const [fin, setFin] = useState("");
  if (isLoading) return <div className="print:hidden p-2"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (!s) return null; // no access (field tech) or invoice missing

  const startEdit = () => { setDep(s.deposit_date || s.final_date || ""); setDays(s.final_after_days); setCustom(!s.final_date_auto && !!s.final_date); setUnset(s.has_deposit && !s.final_date); setFin(s.final_date || ""); setOpen(true); };
  const finPreview = custom ? fin : s.has_deposit && dep ? addDaysIso(dep, days) : dep;
  const save = async (reset = false) => {
    setBusy(true);
    const args = reset ? { p_invoice: invoiceId, p_deposit_date: null, p_final_after_days: null, p_final_date: null }
      : { p_invoice: invoiceId, p_deposit_date: dep || null, p_final_after_days: days, p_final_date: custom && !unset ? fin || null : null };
    let { error } = await sb.rpc("set_invoice_payment_dates", args);
    if (!error && s?.has_deposit) ({ error } = await sb.rpc("set_invoice_final_unscheduled", { p_invoice: invoiceId, p_on: !reset && unset }));
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(reset ? "Back to automatic dates" : "Payment dates saved"); setOpen(false);
    qc.invalidateQueries({ queryKey: ["invoice-pay-schedule", invoiceId] }); qc.invalidateQueries({ queryKey: ["cashflow"] });
  };

  return (
    <Card className="print:hidden rounded-2xl" data-testid="payment-schedule">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-[#1590D6]" /> Expected payments</p>
          {s.can_edit && <Button variant="ghost" size="sm" className="h-9" onClick={startEdit}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit dates</Button>}
        </div>
        {s.has_deposit && <Row label="Deposit" amount={s.deposit_amount} date={s.deposit_date} auto={s.deposit_date_auto} paid={s.deposit_paid} outstanding={s.deposit_outstanding} status={s.deposit_status} />}
        <Row label={s.has_deposit ? "Final" : "Payment"} amount={s.final_amount} date={s.final_date} auto={s.final_date_auto} paid={s.final_paid} outstanding={s.final_outstanding} status={s.final_status} />
        <p className="text-xs text-muted-foreground">Terms {s.terms_days} days after invoice{s.has_deposit ? (s.final_date ? `, final ${s.final_after_days} days after deposit` : ", final date not set yet") : ""}. Feeds cash flow. Dates only, amounts never change here.</p>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Expected payment dates</DialogTitle>
            <DialogDescription>For the cash-flow forecast only. Nothing is sent to the client.</DialogDescription></DialogHeader>
          <label className="block text-sm">{s.has_deposit ? "Deposit expected" : "Payment expected"}
            <Input type="date" value={dep} onChange={(e) => setDep(e.target.value)} className="mt-1 h-11 rounded-xl" /></label>
          {s.has_deposit && <div className="space-y-2">
            <p className="text-sm">Final payment</p>
            <div className="flex flex-wrap gap-2">
              {PICKS.map((n) => <button key={n} type="button" onClick={() => { setDays(n); setCustom(false); setUnset(false); }}
                className={cn("h-11 rounded-full border px-4 text-sm", !custom && !unset && days === n ? "border-[#1590D6] bg-[#E8F6FE] text-[#1590D6] font-semibold" : "")}>{n} days after deposit</button>)}
              <button type="button" onClick={() => { setCustom(true); setUnset(false); if (!fin) setFin(finPreview); }}
                className={cn("h-11 rounded-full border px-4 text-sm", custom && !unset ? "border-[#1590D6] bg-[#E8F6FE] text-[#1590D6] font-semibold" : "")}>Pick a date</button>
              <button type="button" data-testid="pay-final-unset" onClick={() => setUnset(true)}
                className={cn("h-11 rounded-full border px-4 text-sm", unset ? "border-[#1590D6] bg-[#E8F6FE] text-[#1590D6] font-semibold" : "")}>Not set yet</button>
            </div>
            {!custom && !unset && !PICKS.includes(days) && <p className="text-xs text-muted-foreground">Currently {days} days (client default).</p>}
            {unset ? <p className="text-xs text-muted-foreground">Final date not set: shown as Unscheduled, kept out of the dated forecast.</p> : custom ? <Input type="date" value={fin} min={dep || undefined} onChange={(e) => setFin(e.target.value)} className="h-11 rounded-xl" />
              : <p className="text-xs text-muted-foreground">Final expected {fmtDate(finPreview || null)}</p>}
          </div>}
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => save(true)}>Use automatic</Button>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => save(false)} className="bg-[#F7941D] hover:bg-[#e08310] text-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
