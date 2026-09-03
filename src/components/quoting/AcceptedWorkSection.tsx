import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, ReceiptText, HardHat, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLaneStaff } from "@/hooks/useLaneStaff";
import { ensureDepositInvoiceForQuote, fetchQuoteInvoice } from "@/lib/depositInvoice";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  quoteId: string;
}

const DURATIONS = [
  { label: "2 h", value: 120 },
  { label: "4 h", value: 240 },
  { label: "Full day", value: 480 },
  { label: "2 days", value: 960 },
];

const addMinutesToTime = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + (m || 0) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Post-acceptance workspace for a sales quote.
 * Deposit invoice first, then a linked installation job on the Technical lane.
 * Same customer, same lead, same quote — never a second lead.
 */
const AcceptedWorkSection = ({ quoteId }: Props) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { technicians } = useLaneStaff();

  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [duration, setDuration] = useState(240);
  const [techId, setTechId] = useState("");

  const { data: quote } = useQuery({
    queryKey: ["accepted-work-quote", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, quote_number, status, company_id, customer_id, lead_id, customer_name, sales_engineer_id")
        .eq("id", quoteId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: invoice, isLoading: invoiceLoading } = useQuery({
    queryKey: ["accepted-work-invoice", quoteId],
    enabled: !!quoteId,
    queryFn: () => fetchQuoteInvoice(quoteId),
  });

  const { data: installJob } = useQuery({
    queryKey: ["accepted-work-install-job", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, status, scheduled_for")
        .eq("quote_id", quoteId)
        .eq("job_type", "installation")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const handleCreateDeposit = async () => {
    setBusy("deposit");
    try {
      await ensureDepositInvoiceForQuote(quoteId);
      await qc.invalidateQueries({ queryKey: ["accepted-work-invoice", quoteId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Deposit invoice created ✅" });
    } catch (e: any) {
      toast({ title: "Could not create deposit invoice", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  const handlePassToInstall = async () => {
    if (!quote || !invoice?.id) return;
    if (!date) return; // Date is required — never submit without it
    setBusy("install");
    try {
      // Idempotent: never create a second installation job for this quote.
      let jobId = installJob?.id as string | undefined;

      if (!jobId) {
        let address: string | null = null;
        let lat: number | null = null;
        let lng: number | null = null;
        if (quote.lead_id) {
          const { data: lead } = await supabase
            .from("leads")
            .select("customer_address, latitude, longitude")
            .eq("id", quote.lead_id)
            .maybeSingle();
          address = (lead as any)?.customer_address ?? null;
          lat = (lead as any)?.latitude ?? null;
          lng = (lead as any)?.longitude ?? null;
        }
        if (!address && quote.customer_id) {
          const { data: cust } = await supabase
            .from("customers")
            .select("address, latitude, longitude")
            .eq("id", quote.customer_id)
            .maybeSingle();
          address = (cust as any)?.address ?? address;
          lat = lat ?? (cust as any)?.latitude ?? null;
          lng = lng ?? (cust as any)?.longitude ?? null;
        }

        const scheduledFor = date ? new Date(`${date}T${startTime || "08:00"}:00`).toISOString() : null;

        const { data: job, error: jobErr } = await supabase
          .from("jobs")
          .insert([{
            company_id: quote.company_id,
            customer_id: quote.customer_id,
            lead_id: quote.lead_id,
            quote_id: quote.id,
            invoice_id: invoice.id,
            job_type: "installation",
            status: "scheduled",
            title: `Installation — ${quote.customer_name || "Customer"}`,
            description: `Installation from accepted quote ${quote.quote_number || ""}`.trim(),
            address,
            lat,
            lng,
            scheduled_for: scheduledFor,
            created_by: user?.id ?? null,
          } as any])
          .select("id")
          .single();
        if (jobErr || !job) throw jobErr || new Error("Could not create the installation job");
        jobId = job.id;
      }

      if (techId && jobId) {
        await supabase.from("assignments").insert([{
          job_id: jobId,
          profile_id: techId,
          assignment_type: "primary",
          assigned_by: user?.id ?? null,
        } as any]);
      }

      // Calendar row for the install day, keyed to the installation JOB so it can
      // never collide with the salesperson's own visit row on the same lead.
      // No named tech => agent_id null => shows in the Technical pool as first-accept.
      if (quote.lead_id && date && jobId) {
        await supabase.from("job_schedules").insert([{
          lead_id: quote.lead_id,
          job_id: jobId,
          agent_id: techId || null,
          scheduled_date: date,
          start_time: startTime || "08:00",
          end_time: addMinutesToTime(startTime || "08:00", duration),
          notes: `Installation — quote ${quote.quote_number || ""}`.trim(),
        } as any]);
      }


      await qc.invalidateQueries({ queryKey: ["accepted-work-install-job", quoteId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dispatch-schedules"] });
      setDialogOpen(false);
      toast({ title: "Passed to Technical ✅", description: "Installation job created on the technical lane." });
    } catch (e: any) {
      toast({ title: "Handover failed", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  if (!quote || String(quote.status || "").toLowerCase() !== "accepted") return null;

  const hasDeposit = !!invoice?.id;
  // Payment can land later — Pass only requires the invoice ROW to exist.
  // Unpaid/draft still allows Pass, with an amber warning.
  const depositCleared = !!invoice && (
    ["paid", "partially_paid"].includes(String(invoice.status || "").toLowerCase()) || !!invoice.paid_date
  );
  const showDepositDueWarning = hasDeposit && !depositCleared;

  return (
    <section className="rounded-lg border border-border bg-card p-4 print:hidden">
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Accepted work
      </h2>

      {/* Step 1 — deposit invoice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <ReceiptText className="h-4 w-4 text-muted-foreground" />
          {invoiceLoading ? (
            <span className="text-muted-foreground">Checking deposit invoice…</span>
          ) : hasDeposit ? (
            <span>
              Deposit invoice <span className="font-semibold">{invoice?.invoice_number}</span>{" "}
              <DepositPaymentChip invoice={invoice} accepted className="ml-1 align-middle" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              No deposit invoice yet — create it first. <DepositPaymentChip invoice={null} accepted />
            </span>
          )}
        </div>
        {hasDeposit ? (
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/invoices?highlight=${invoice?.id}`)}>
            View invoice <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="sm" variant="brand" onClick={handleCreateDeposit} disabled={busy === "deposit"}>
            {busy === "deposit" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Create deposit invoice
          </Button>
        )}
      </div>

      {/* Step 2 — pass to technical */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <HardHat className="h-4 w-4 text-muted-foreground" />
          {installJob ? (
            <span>
              Installation job created
              {installJob.scheduled_for
                ? ` — ${format(new Date(installJob.scheduled_for), "d MMM yyyy HH:mm")}`
                : " — not scheduled"}
              <Badge variant="secondary" className="ml-2 align-middle">{installJob.status}</Badge>
            </span>
          ) : (
            <span className="text-muted-foreground">Hand the job over to the installation team.</span>
          )}
        </div>
        {installJob ? (
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/jobs/${installJob.id}`)}>
            Open job <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button size="sm" variant="brand" disabled={!hasDeposit} onClick={() => setDialogOpen(true)}>
                    Pass to Technical / Installation
                  </Button>
                </span>
              </TooltipTrigger>
              {!hasDeposit && (
                <TooltipContent>
                  Deposit invoice required first — payment can come later
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pass to Technical / Installation</DialogTitle>
            <DialogDescription>
              Creates linked installation job on this lead. Sales stays on the commercial thread.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {showDepositDueWarning && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Deposit still due — install can proceed
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                {!date && (
                  <p className="text-xs text-muted-foreground">Choose a date to enable Confirm.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Technician</Label>
              <Select value={techId || "unassigned"} onValueChange={(v) => setTechId(v === "unassigned" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Leave open for first-accept" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Leave open (first-accept)</SelectItem>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A named technician also gets a calendar slot under Technical on dispatch.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={handlePassToInstall}
              disabled={busy === "install" || !hasDeposit || !date}
            >
              {busy === "install" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create installation job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AcceptedWorkSection;
