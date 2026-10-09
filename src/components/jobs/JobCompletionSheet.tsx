/**
 * Technician "Finish job" form (Johan 23:11) — simple, big buttons, logical order:
 *   1. Times (prefilled from the actual start / booking; "Times differ?" to adjust)
 *   2. Done as quoted?  [Yes, as quoted] [No, extras used]
 *   3. Extras (only if "No"): materials with quantity only (packing list / catalogue / free text) + extra hours
 *   4. Note (optional)   5. Photos (count)   6. Customer signature   7. [Finish job]
 * On submit: lead/job -> completed (existing path) and an invoice request goes to the office
 * (submit_invoice_request: "As quoted" or "Changes"). Techs never see prices or invoices.
 */
import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, ChevronDown, Clock, Images, Loader2, Minus, Plus, PackagePlus, Trash2, WifiOff } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { useJobCompletion } from "@/hooks/useJobCompletion";
import SignaturePad from "./SignaturePad";
import { findOpenJobIdsForLead } from "@/lib/completeLeadJobs";
import { durationText, prefillTimes, timeText, toLocalInput } from "@/lib/completionTimes";
import { cn } from "@/lib/utils";

export interface CompletionExtra { product_id: string | null; name: string; qty: number }

interface JobCompletionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  jobId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  startedAt?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  onCompleted?: () => void;
}

type CatalogueRow = { id: string; product_code: string | null; short_name: string | null };

const JobCompletionSheet = ({
  open, onOpenChange, leadId, jobId, customerName, customerEmail, startedAt, scheduledDate, scheduledTime, onCompleted,
}: JobCompletionSheetProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineContext();
  const { submit } = useJobCompletion();

  const [asQuoted, setAsQuoted] = useState<boolean | null>(null);
  const [extras, setExtras] = useState<CompletionExtra[]>([]);
  const [extraHours, setExtraHours] = useState("");
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(customerName || "");
  const [noSignature, setNoSignature] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [other, setOther] = useState("");
  const [timesOpen, setTimesOpen] = useState(false);
  const [startInput, setStartInput] = useState("");
  const [finishInput, setFinishInput] = useState("");

  // Prefill times each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const t = prefillTimes({ startedAt, scheduledDate, scheduledTime });
    setStartInput(toLocalInput(t.start));
    setFinishInput(toLocalInput(t.finish));
  }, [open, startedAt, scheduledDate, scheduledTime]);
  const start = startInput ? new Date(startInput) : null;
  const finish = finishInput ? new Date(finishInput) : null;
  const timesBad = !!(start && finish && finish < start);

  const { data: photoCount = 0 } = useQuery({
    queryKey: ["job-photo-count", leadId],
    queryFn: async () => {
      const { count, error } = await supabase.from("job_photos" as never).select("id", { count: "exact", head: true }).eq("lead_id", leadId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: open && !!leadId && isOnline,
  });

  const { data: resolvedJobId = null } = useQuery({
    queryKey: ["lead-open-job", leadId],
    queryFn: async () => (await findOpenJobIdsForLead(leadId))[0] ?? null,
    enabled: open && !!leadId && !jobId && isOnline,
  });
  const effectiveJobId = jobId ?? resolvedJobId;

  // Quick-add from this job's packing list (names/qty only).
  const { data: packing = [] } = useQuery({
    queryKey: ["completion-packing", effectiveJobId],
    enabled: open && !!effectiveJobId && isOnline && asQuoted === false,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)("get_job_packing_list", { p_job_id: effectiveJobId });
      const seen = new Set<string>();
      return ((data || []) as { item_code: string | null; item_name: string | null }[])
        .filter((r) => r.item_name && !seen.has(`${r.item_code}|${r.item_name}`) && seen.add(`${r.item_code}|${r.item_name}`))
        .slice(0, 12);
    },
  });

  // Catalogue names/codes only (prices are stripped here; the office prices extras on approval).
  const { data: catalogue = [] } = useQuery({
    queryKey: ["completion-catalogue"],
    enabled: open && asQuoted === false && isOnline,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)("get_product_sell_options");
      return ((data || []) as CatalogueRow[]).map((r) => ({ id: r.id, product_code: r.product_code, short_name: r.short_name }));
    },
  });
  const term = search.trim().toLowerCase();
  const hits = term.length >= 2
    ? catalogue.filter((h) => (h.short_name || "").toLowerCase().includes(term) || (h.product_code || "").toLowerCase().includes(term)).slice(0, 8)
    : [];
  const byCode = useMemo(() => new Map(catalogue.filter((c) => c.product_code).map((c) => [c.product_code as string, c])), [catalogue]);

  const addExtra = (e: CompletionExtra) => setExtras((xs) => {
    const i = xs.findIndex((x) => (e.product_id && x.product_id === e.product_id) || (!e.product_id && !x.product_id && x.name === e.name));
    return i >= 0 ? xs.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)) : [...xs, e];
  });
  const setQty = (i: number, qty: number) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.round(qty * 2) / 2) } : x)));
  const removeExtra = (i: number) => setExtras((xs) => xs.filter((_, j) => j !== i));

  const hours = Number(extraHours);
  const hasExtras = extras.some((x) => x.qty > 0) || (extraHours.trim() !== "" && hours > 0);
  const extrasMissing = asQuoted === false && !hasExtras;
  const offlineExtras = asQuoted === false && !isOnline;
  const canSubmit = asQuoted !== null && !extrasMissing && !offlineExtras && (!!signature || noSignature) && !timesBad && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const labourMinutes = start && finish ? Math.max(0, Math.round((finish.getTime() - start.getTime()) / 60000)) : 0;
      const { queued } = await submit({
        leadId,
        jobId: effectiveJobId,
        workSummary: note.trim() || (asQuoted ? "Done as quoted" : "Done with extras (see invoice request)"),
        customerName: signerName || customerName,
        customerEmail: customerEmail || null,
        signatureDataUrl: signature,
        partsTotal: 0, // server recomputes parts_total
        labourMinutes,
        photoCount,
        metricsKnown: isOnline,
      });
      if (!queued) {
        const { error } = await (supabase.rpc as any)("submit_invoice_request", {
          p_lead_id: leadId,
          p_job_id: effectiveJobId,
          p_extra_items: asQuoted ? [] : extras.filter((x) => x.qty > 0),
          p_extra_hours: asQuoted || !(hours > 0) ? null : hours,
          p_note: note.trim() || null,
          p_started_at: start ? start.toISOString() : null,
          p_finished_at: finish ? finish.toISOString() : null,
        });
        if (error) {
          toast({ title: "Job completed, but the office request failed", description: `${error.message}. Please tell the office.`, variant: "destructive" });
        } else {
          toast({ title: "Job finished ✅", description: asQuoted ? "Sent to the office: as quoted." : "Sent to the office with your extras." });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["my-invoice-requests"] });
      onCompleted?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not finish the job", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const choice = (active: boolean, tone: "green" | "orange") => cn(
    "h-14 flex-1 rounded-xl border-2 text-base font-semibold",
    active
      ? tone === "green" ? "border-green-700 bg-green-600 text-white hover:bg-green-700" : "border-orange-700 bg-orange-500 text-white hover:bg-orange-600"
      : "border-border bg-background text-foreground hover:bg-muted",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[94vh] overflow-y-auto p-4 sm:mx-auto sm:max-w-2xl" data-testid="finish-job-sheet">
        <SheetHeader className="mb-2 text-left">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            Finish job{customerName ? ` – ${customerName}` : ""}
          </SheetTitle>
        </SheetHeader>

        {!isOnline && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <WifiOff className="h-4 w-4" /> Offline — "as quoted" will sync later. Extras need a connection.
          </div>
        )}

        <div className="space-y-5">
          {/* 1. Times */}
          <section className="rounded-xl border border-border p-3" data-testid="finish-times">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span><b>Started</b> {timeText(start)}</span>
              <span className="text-muted-foreground">·</span>
              <span><b>Finished</b> {timeText(finish)}</span>
              {start && finish && !timesBad && <span className="ml-auto text-muted-foreground">{durationText(start, finish)}</span>}
            </div>
            <Collapsible open={timesOpen} onOpenChange={setTimesOpen}>
              <CollapsibleTrigger asChild>
                <button type="button" className="mt-2 flex items-center gap-1 text-sm font-medium text-primary" data-testid="times-differ">
                  Times differ? <ChevronDown className={cn("h-4 w-4 transition-transform", timesOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="t-start">Started</Label>
                  <Input id="t-start" type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="t-finish">Finished</Label>
                  <Input id="t-finish" type="datetime-local" value={finishInput} onChange={(e) => setFinishInput(e.target.value)} className="h-11" />
                </div>
                {timesBad && <p className="text-sm text-destructive sm:col-span-2">Finish must be after start.</p>}
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* 2. As quoted? */}
          <section className="space-y-2">
            <p className="text-base font-semibold">Was the job done as quoted?</p>
            <div className="flex gap-2">
              <Button type="button" className={choice(asQuoted === true, "green")} onClick={() => setAsQuoted(true)} data-testid="as-quoted-yes">
                Yes, as quoted
              </Button>
              <Button type="button" className={choice(asQuoted === false, "orange")} onClick={() => setAsQuoted(false)} data-testid="as-quoted-no">
                No, extras used
              </Button>
            </div>
          </section>

          {/* 3. Extras */}
          {asQuoted === false && (
            <section className="space-y-4 rounded-xl border-2 border-orange-300 p-3" data-testid="finish-extras">
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-base font-semibold"><PackagePlus className="h-5 w-5" />Extra materials used</p>
                {packing.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">From this job's packing list — tap to add</p>
                    <div className="flex flex-wrap gap-1.5">
                      {packing.map((p) => (
                        <button key={`${p.item_code}|${p.item_name}`} type="button" data-no-min
                          className="rounded-full border border-border bg-muted px-3 py-1.5 text-sm hover:bg-muted/70"
                          onClick={() => addExtra({ product_id: (p.item_code && byCode.get(p.item_code)?.id) || null, name: p.item_name as string, qty: 1 })}>
                          + {p.item_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search catalogue by name or code" className="h-11" data-testid="extras-search" />
                {hits.length > 0 && (
                  <div className="rounded-md border border-border">
                    {hits.map((h) => (
                      <button key={h.id} type="button" className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                        onClick={() => { addExtra({ product_id: h.id, name: h.short_name || h.product_code || "Item", qty: 1 }); setSearch(""); }}>
                        {h.short_name} <span className="text-muted-foreground">{h.product_code}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Not in the list? Type it" className="h-11" />
                  <Button type="button" variant="outline" className="h-11" disabled={!other.trim()}
                    onClick={() => { addExtra({ product_id: null, name: other.trim().slice(0, 200), qty: 1 }); setOther(""); }}>
                    <Plus className="mr-1 h-4 w-4" />Add
                  </Button>
                </div>
                {extras.length > 0 && (
                  <ul className="divide-y rounded-md border border-border" data-testid="extras-list">
                    {extras.map((x, i) => (
                      <li key={`${x.product_id ?? x.name}-${i}`} className="flex items-center gap-2 px-2 py-2">
                        <span className="flex-1 text-sm">{x.name}</span>
                        <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label={`Less ${x.name}`} onClick={() => setQty(i, x.qty - 1)}><Minus className="h-4 w-4" /></Button>
                        <Input aria-label={`Quantity for ${x.name}`} className="h-10 w-16 text-center text-base" type="number" min="0" step="0.5" inputMode="decimal"
                          value={x.qty} onChange={(e) => setQty(i, Number(e.target.value) || 0)} />
                        <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label={`More ${x.name}`} onClick={() => setQty(i, x.qty + 1)}><Plus className="h-4 w-4" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" aria-label={`Remove ${x.name}`} onClick={() => removeExtra(i)}><Trash2 className="h-4 w-4" /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="extra-hours" className="text-base font-semibold">Extra time (hours, optional)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {["0.5", "1", "2"].map((h) => (
                    <Button key={h} type="button" variant={extraHours === h ? "default" : "outline"} className="h-11 min-w-[64px]" onClick={() => setExtraHours(h)}>{h} h</Button>
                  ))}
                  <Input id="extra-hours" type="number" inputMode="decimal" min="0" step="0.5" value={extraHours}
                    onChange={(e) => setExtraHours(e.target.value)} placeholder="Other" className="h-11 w-24" />
                </div>
              </div>
              {extrasMissing && <p className="text-sm text-orange-700 dark:text-orange-300">Add at least one item or extra hours — or choose "Yes, as quoted".</p>}
            </section>
          )}

          {/* 4. Note */}
          <section className="space-y-1.5">
            <Label htmlFor="finish-note" className="text-base font-semibold">Note for the office <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="finish-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything the office should know…" />
          </section>

          {/* 5. Photos */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <Images className="h-5 w-5 text-muted-foreground" />
            {isOnline ? `${photoCount} photo${photoCount === 1 ? "" : "s"} attached` : "Photos sync later"}
            <span className="ml-auto text-xs text-muted-foreground">Add photos from the job screen</span>
          </div>

          {/* 6. Signature */}
          <section className="space-y-2">
            <Label className="text-base font-semibold">Customer signature</Label>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Customer name" className="h-11" aria-label="Signed off by" />
            <SignaturePad value={signature} onChange={setSignature} />
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="no-signature" data-no-min className="h-6 w-6" checked={noSignature} onCheckedChange={(v) => setNoSignature(v === true)} />
              <Label htmlFor="no-signature" className="text-sm font-normal text-muted-foreground">Customer not available to sign</Label>
            </div>
          </section>

          {/* 7. Submit */}
          <Button className="h-14 w-full rounded-xl bg-green-600 text-lg font-bold text-white hover:bg-green-700" disabled={!canSubmit} onClick={handleSubmit} data-testid="finish-submit">
            {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
            Finish job
          </Button>
          {!canSubmit && !saving && (
            <p className="text-center text-sm text-muted-foreground" data-testid="finish-hint">
              {asQuoted === null ? "Choose \"Yes, as quoted\" or \"No, extras used\"."
                : offlineExtras ? "You're offline: extras need a connection."
                : extrasMissing ? "Add the extras, or choose \"Yes, as quoted\"."
                : timesBad ? "Fix the times."
                : "Customer signature needed — or tick \"Customer not available to sign\"."}
            </p>
          )}
          <p className="pb-4 text-center text-xs text-muted-foreground">The office checks it and does the invoice — you never need to invoice.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default JobCompletionSheet;
