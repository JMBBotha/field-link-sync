import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, ReceiptText, HardHat, CheckCircle2, ArrowRight, Copy, Mail, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLaneStaff } from "@/hooks/useLaneStaff";
import { ensureDepositInvoiceForQuote, fetchQuoteInvoice, depositPercentOf } from "@/lib/depositInvoice";
import DepositPaymentChip, { isDepositCleared } from "@/components/shared/DepositPaymentChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { publicQuoteUrl } from "@/lib/publicAppUrl";
import { useClashGuard } from "@/components/scheduling/ClashGuard";
import { minutesToInterval } from "@/lib/schedulingDefaults";
import { TimeInput24 } from "@/components/ui/time-input-24";
import AvailabilityPicker from "@/components/scheduling/AvailabilityPicker";
import { defaultModeFor, handoffModesFor, handoffStatusText, type HandoffMode, type HandoffStatus } from "@/lib/installHandoff";

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
  const { confirmBooking, flushOverride, dialog: clashDialog } = useClashGuard();

  const { data: siteLoc } = useQuery({
    queryKey: ["accepted-work-site-loc", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data: q } = await supabase.from("quotes").select("lead_id, customer_id").eq("id", quoteId).maybeSingle();
      if (q?.lead_id) {
        const { data: l } = await supabase.from("leads").select("latitude, longitude").eq("id", q.lead_id).maybeSingle();
        if (l?.latitude != null) return { lat: Number(l.latitude), lng: Number(l.longitude) };
      }
      if (q?.customer_id) {
        const { data: c } = await supabase.from("customers").select("latitude, longitude").eq("id", q.customer_id).maybeSingle();
        if (c?.latitude != null) return { lat: Number(c.latitude), lng: Number(c.longitude) };
      }
      return null;
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [duration, setDuration] = useState(240);
  const [techId, setTechId] = useState("");
  const [mode, setMode] = useState<HandoffMode>("pick");

  // P3: server-side hand-off status (who may hand over, company default, offers in flight)
  const { data: handoff, refetch: refetchHandoff } = useQuery({
    queryKey: ["install-handoff-status", quoteId],
    enabled: !!quoteId,
    refetchInterval: (q: any) => ((q?.state?.data as HandoffStatus | null)?.pending ? 15000 : false),
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("install_handoff_status", { p_quote_id: quoteId });
      if (error) throw error;
      return (data ?? null) as HandoffStatus | null;
    },
  });
  const modes = handoffModesFor(handoff?.role);
  const openHandoff = (m?: HandoffMode) => {
    setMode(m && modes.includes(m) ? m : defaultModeFor(handoff?.role, handoff?.default_mode));
    setDialogOpen(true);
  };

  const { data: quote } = useQuery({
    queryKey: ["accepted-work-quote", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, quote_number, status, company_id, customer_id, lead_id, customer_name, sales_engineer_id, public_token, total, customers(email, phone, name)")
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

  const clientLink = quote?.public_token ? publicQuoteUrl(quote.public_token) : null;
  const customer = quote?.customers as { email?: string | null; phone?: string | null; name?: string | null } | null;

  const copyDepositLink = async () => {
    if (!clientLink) return;
    await navigator.clipboard.writeText(clientLink);
    toast({ title: "Deposit link copied" });
  };

  const depPct = depositPercentOf(invoice, Number(quote?.total) || null);
  const depLabel = depPct ? `${depPct}% deposit invoice` : "deposit invoice";

  const sendDepositWhatsApp = () => {
    if (!clientLink) return;
    const phone = (customer?.phone || "").replace(/\D/g, "").replace(/^0/, "27");
    const message = `Hi ${customer?.name || quote?.customer_name || "there"}, your ${depLabel} for quote ${quote?.quote_number || ""} is ready. View and pay securely here: ${clientLink}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  const sendDepositEmail = async () => {
    if (!customer?.email || !clientLink) {
      toast({ title: "Client email unavailable", variant: "destructive" });
      return;
    }
    setBusy("deposit-email");
    try {
      const { data, error } = await supabase.functions.invoke("send-quote-email", {
        body: {
          to: customer.email,
          subject: `Your ${depLabel} — ${quote?.quote_number || "quote"}`,
          quoteNumber: quote?.quote_number,
          quoteId,
          customerId: quote?.customer_id,
          clientName: customer.name || quote?.customer_name,
          totalAmount: Number(invoice?.grand_total) || Number(quote?.total) * 0.7 || 0,
          quoteUrl: clientLink,
          depositRequest: true,
        },
      });
      const payload = data as { success?: boolean; code?: string; message?: string } | null;
      if (error || payload?.code === "EMAIL_NOT_CONFIGURED" || payload?.success !== true) {
        const detail = payload?.code === "EMAIL_NOT_CONFIGURED" ? "EMAIL_NOT_CONFIGURED" : payload?.message || error?.message;
        throw new Error(detail || "Deposit email failed");
      }
      toast({ title: "Deposit request emailed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit email failed";
      toast({
        title: message.includes("EMAIL_NOT_CONFIGURED") ? "Email not configured" : "Email failed",
        description: message.includes("EMAIL_NOT_CONFIGURED") ? "Use WhatsApp or Copy link instead." : message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handlePassToInstall = async () => {
    if (!quote || !invoice?.id) return;
    if (!date) return; // Date is required — never submit without it
    const pick = mode === "pick";
    if (pick && !techId) {
      toast({ title: "Pick a technician", description: "Or choose Offer to my technicians.", variant: "destructive" });
      return;
    }
    if (pick) {
      const ok = await confirmBooking({
        profileId: techId, date, start: startTime || "08:00", end: addMinutesToTime(startTime || "08:00", duration),
        excludeJobId: installJob?.id ?? null,
        entity: installJob?.id ? { type: "job", id: installJob.id } : quote.lead_id ? { type: "lead", id: quote.lead_id } : { type: "job", id: "" },
      });
      if (!ok) return;
    }
    setBusy("install");
    try {
      // One controlled server-side step: job (idempotent per quote), calendar row, then the tech or the offers.
      const { data, error } = await (supabase as any).rpc("hand_to_technician", {
        p_quote_id: quote.id,
        p_date: date,
        p_start: startTime || "08:00",
        p_minutes: duration,
        p_mode: mode,
        p_tech_id: pick ? techId : null,
      });
      if (error) throw error;
      const res = data as { ok: boolean; job_id?: string; message?: string; offered?: number };
      if (res?.job_id && pick) void flushOverride({ type: "job", id: res.job_id });
      await qc.invalidateQueries({ queryKey: ["accepted-work-install-job", quoteId] });
      await refetchHandoff();
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dispatch-schedules"] });
      qc.invalidateQueries({ queryKey: ["my-visits"] });
      if (!res?.ok) {
        toast({ title: "Not handed over", description: res?.message, variant: "destructive" });
      } else if (!pick && !res.offered) {
        toast({ title: "No technician is free then", description: res.message });
        if (modes.includes("pick")) { setMode("pick"); setBusy(null); return; } // office: switch to Pick
        setDialogOpen(false);
      } else {
        setDialogOpen(false);
        toast({ title: pick ? "Passed to Technical ✅" : "Offered to technicians", description: res.message });
      }
    } catch (e: any) {
      toast({ title: "Handover failed", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  if (!quote || String(quote.status || "").toLowerCase() !== "accepted") return null;

  const hasDeposit = !!invoice?.id;
  // Payment can land later — Pass only requires the invoice ROW to exist.
  // Unpaid/draft still allows Pass, with an amber warning.
  // Same allocation math as the chip — status/paid_date never clear a deposit.
  const depositCleared = isDepositCleared(invoice);
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
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="icon" onClick={sendDepositEmail} disabled={!clientLink || !customer?.email || busy === "deposit-email"} title="Email deposit request">
              {busy === "deposit-email" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="outline" size="icon" onClick={sendDepositWhatsApp} disabled={!clientLink} title="WhatsApp deposit request">
              <MessageCircle className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" onClick={copyDepositLink} disabled={!clientLink} title="Copy deposit link">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/admin/invoices?highlight=${invoice?.id}`)}>
              View invoice <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
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
              {handoffStatusText(handoff) && (
                <span className="mt-0.5 block text-xs text-muted-foreground" data-testid="handoff-status">{handoffStatusText(handoff)}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Hand the job over to the installation team.</span>
          )}
        </div>
        {installJob ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {handoff && !handoff.technician && !handoff.pending && (modes.includes("pick") || !handoff.unclaimed) && (
              <Button size="sm" variant="brand" onClick={() => openHandoff(handoff.unclaimed ? "pick" : undefined)} data-testid="handoff-again">
                {modes.includes("pick") ? "Pick technician" : "Offer again"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate(`/admin/jobs/${installJob.id}`)}>
              Open job <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button size="sm" variant="brand" disabled={!hasDeposit || !handoff} onClick={() => openHandoff()} data-testid="handoff-open">
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
                <TimeInput24 value={startTime} onChange={(e) => setStartTime(e.target.value)} />
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

            {modes.length > 1 ? (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hand-off" data-testid="handoff-modes">
                {modes.map((m) => (
                  <Button key={m} type="button" role="radio" aria-checked={mode === m} variant={mode === m ? "brand" : "outline"}
                    className="h-auto min-h-11 whitespace-normal py-2 text-xs" onClick={() => setMode(m)} data-testid={`handoff-mode-${m}`}>
                    {m === "pick" ? "Pick technician" : "Offer to my technicians (first to accept, 15 min)"}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="handoff-offer-only">
                Your technicians get an offer in the app; the first to accept within 15 minutes gets the job. If nobody takes it, the office picks one.
              </p>
            )}

            {mode === "pick" ? (
              <div className="space-y-1.5">
                <Label>Technician</Label>
                <Select value={techId || undefined} onValueChange={setTechId}>
                  <SelectTrigger><SelectValue placeholder="Choose a technician" /></SelectTrigger>
                  <SelectContent>
                    {technicians.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The technician also gets a calendar slot under Technical on dispatch.
                </p>
                {date && (
                  <AvailabilityPicker lane="service" date={date} startTime={startTime} minutes={duration}
                    lat={siteLoc?.lat} lng={siteLoc?.lng} excludeJobId={installJob?.id ?? null} selectedId={techId}
                    onSelect={(id, d, t) => { setTechId(id); if (d) setDate(d); if (t) setStartTime(t); }} />
                )}
              </div>
            ) : modes.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                Offered in the app only (no WhatsApp). Techs who are busy then are skipped. Nobody in 15 min: one more round, then you're asked to pick.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={handlePassToInstall}
              disabled={busy === "install" || !hasDeposit || !date || (mode === "pick" && !techId)}
              data-testid="handoff-confirm"
            >
              {busy === "install" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "pick" ? "Create installation job" : "Offer to technicians"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {clashDialog}
    </section>
  );
};

export default AcceptedWorkSection;
