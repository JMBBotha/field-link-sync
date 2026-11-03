import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import AddJobPhotosButton from "@/components/jobs/AddJobPhotosButton";
import { JobTypeChoice } from "@/components/jobs/JobTypeChoice";
import {
  kindOfJobType, techJobTypeLabel, latestTypeChange, requestTypeChange, flagSalesLead, unitNotViable, validReason, CALL_OUT_NOTE,
  JOB_KIND_META, type JobKind,
} from "@/lib/jobTypeChoice";

/**
 * Tech job sheet: job type card + a small "Request type change" link (admin approves; only the label changes) +
 * the orange sales button with two options: unit not viable (close as call-out + replacement quote lead) or
 * client also needs a new quote / installation. No client names in any pop-up (POPIA).
 */
export default function TechJobTypePanel({ jobId, jobType, leadId, onClosed }: { jobId: string; jobType: string | null; leadId: string | null; onClosed?: () => void }) {
  const { toast } = useToast();
  const req = useQuery({ queryKey: ["job-type-change", jobId], enabled: !!jobId, queryFn: () => latestTypeChange(jobId) });
  const pending = req.data?.status === "pending" ? req.data : null;
  const current = kindOfJobType(jobType);
  const [changeOpen, setChangeOpen] = useState(false);
  const [to, setTo] = useState<JobKind | null>(null);
  const [reason, setReason] = useState("");
  const [saleOpen, setSaleOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saleMode, setSaleMode] = useState<"pick" | "not_viable" | "also" | "done_not_viable" | "done_also">("pick");

  const sendChange = async () => {
    if (!to || !validReason(reason)) return;
    setBusy(true);
    try {
      const r = await requestTypeChange(jobId, to, reason.trim());
      if (!r?.ok) throw new Error(r?.message || "Request not sent");
      toast({ title: "Sent to admin", description: "Nothing changes until an admin approves." });
      setChangeOpen(false); setReason(""); setTo(null); void req.refetch();
    } catch (e) { toast({ title: "Couldn't send the request", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const sendSale = async () => {
    setBusy(true);
    try {
      const notViable = saleMode === "not_viable";
      const r = notViable ? await unitNotViable(jobId, note.trim()) : await flagSalesLead(jobId, note.trim());
      if (!r?.ok) throw new Error(r?.message || "Lead not created");
      setSaleMode(notViable ? "done_not_viable" : "done_also"); setNote("");
    } catch (e) { toast({ title: "Couldn't create the sales lead", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card data-testid="tech-job-type">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Job type</div>
            <div className="font-semibold">{techJobTypeLabel(jobType)}</div>
            {current === "service" && <div className="text-xs text-muted-foreground">R680 excl. VAT call-out · this visit</div>}
            {pending && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="type-change-waiting">
                ⏳ Waiting for admin: change to {JOB_KIND_META[pending.to_type as JobKind]?.title ?? pending.to_type}
              </div>
            )}
            {req.data?.status === "declined" && <div className="mt-2 text-xs text-muted-foreground">Last change request was declined.</div>}
          </div>
          <button type="button" className="shrink-0 min-h-[44px] text-xs text-[#C2410C] underline disabled:opacity-50" disabled={!!pending}
            onClick={() => { setTo(current === "service" ? "installation" : "service"); setChangeOpen(true); }} data-testid="tech-type-change">
            Request type change
          </button>
        </CardContent>
      </Card>

      <button type="button" onClick={() => { setSaleMode("pick"); setSaleOpen(true); }} data-testid="tech-sales-flag"
        className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-[#C2410C] p-3 text-left text-white shadow">
        <div className="font-semibold">➕ New quote needed</div>
        <div className="text-xs opacity-90">Unit not viable, or the client wants a new unit too</div>
      </button>

      <Sheet open={changeOpen} onOpenChange={setChangeOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Change job type</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-3">
            <JobTypeChoice compact value={to} onChange={setTo} label="Change to" />
            <div className="text-sm font-medium">Why? <span className="text-destructive">*</span></div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Unit beyond repair, client wants a new one" rows={3} data-testid="type-change-reason" />
            <p className="text-xs text-muted-foreground">This goes to the admin/owner. The job type stays the same until they approve.</p>
            <Button className="h-11 w-full bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy || !to || to === current || !validReason(reason)} onClick={sendChange}>
              Send change request
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={saleOpen} onOpenChange={(o) => { setSaleOpen(o); if (!o && saleMode === "done_not_viable") onClosed?.(); }}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{saleMode === "done_not_viable" ? "Call-out closed ✓" : saleMode === "done_also" ? "Sales lead created ✓" : saleMode === "not_viable" ? "Unit not viable" : saleMode === "also" ? "New quote / installation" : "New quote needed"}</SheetTitle></SheetHeader>
          {saleMode === "pick" ? (
            <div className="mt-3 space-y-2">
              {current === "service" && (
                <button type="button" data-testid="sales-opt-not-viable" onClick={() => setSaleMode("not_viable")} className="w-full rounded-xl border-2 border-orange-300 bg-orange-50 p-3 text-left">
                  <div className="font-semibold">🛑 Unit not viable → needs replacement quote</div>
                  <div className="text-xs text-muted-foreground">Closes this job as a call-out (R680 excl. VAT, never deducted) and sends a replacement quote to sales.</div>
                </button>
              )}
              <button type="button" data-testid="sales-opt-also" onClick={() => setSaleMode("also")} className="w-full rounded-xl border-2 p-3 text-left">
                <div className="font-semibold">➕ Client also needs a new quote / installation</div>
                <div className="text-xs text-muted-foreground">Creates a sales lead. This job stays as is.</div>
              </button>
            </div>
          ) : saleMode === "done_not_viable" || saleMode === "done_also" ? (
            <div className="mt-3 space-y-3 text-sm" data-testid="sales-lead-created">
              {saleMode === "done_not_viable"
                ? <p>This job is closed as a call-out: {CALL_OUT_NOTE} A replacement quote lead went to the client's own rep, or the rep offer.</p>
                : <p>A sales rep gets the lead (the client's own rep, or the rep offer). This job stays as it is.</p>}
              {leadId && <div><div className="mb-1 text-xs text-muted-foreground">Optional: add site photos for the rep</div><AddJobPhotosButton leadId={leadId} defaultType="site" /></div>}
              <Button className="w-full" onClick={() => { setSaleOpen(false); if (saleMode === "done_not_viable") onClosed?.(); }}>Done</Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {saleMode === "not_viable" ? (
                <div className="rounded-lg border border-orange-300 bg-orange-50 p-2 text-sm" data-testid="not-viable-warning">
                  This closes the job now as a call-out only. {CALL_OUT_NOTE} No repair is done. A replacement quote lead is created for the client.
                </div>
              ) : <p className="text-sm text-muted-foreground">Creates a New sale lead straight away for this client and address. No approval needed.</p>}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={saleMode === "not_viable" ? "Optional note, e.g. compressor failed, unit 15 years old" : "Optional note, e.g. wants a unit in the main bedroom"} rows={3} data-testid="sales-flag-note" />
              <Button className="h-11 w-full bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy} onClick={sendSale}>
                {saleMode === "not_viable" ? "Close as call-out + send replacement quote" : "Create sales lead"}
              </Button>
              <button type="button" className="w-full text-xs underline" onClick={() => setSaleMode("pick")}>Back</button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
