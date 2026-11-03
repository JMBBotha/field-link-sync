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
  kindOfJobType, techJobTypeLabel, latestTypeChange, requestTypeChange, flagSalesLead, validReason,
  JOB_KIND_META, type JobKind,
} from "@/lib/jobTypeChoice";

/**
 * Tech job sheet: job type card + Change (a request to admin, never a direct change) + the one-tap
 * "Client also needs a new quote / installation" sales lead. No client names in any pop-up (POPIA).
 */
export default function TechJobTypePanel({ jobId, jobType, leadId }: { jobId: string; jobType: string | null; leadId: string | null }) {
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
  const [saleDone, setSaleDone] = useState(false);

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
      const r = await flagSalesLead(jobId, note.trim());
      if (!r?.ok) throw new Error(r?.message || "Lead not created");
      setSaleDone(true); setNote("");
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
          <Button variant="outline" className="min-h-[44px] border-2 border-[#C2410C] text-[#C2410C]" disabled={!!pending}
            onClick={() => { setTo(current === "service" ? "installation" : "service"); setChangeOpen(true); }} data-testid="tech-type-change">
            Change
          </Button>
        </CardContent>
      </Card>

      <button type="button" onClick={() => { setSaleDone(false); setSaleOpen(true); }} data-testid="tech-sales-flag"
        className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-[#C2410C] p-3 text-left text-white shadow">
        <div className="font-semibold">➕ Client also needs a new quote / installation</div>
        <div className="text-xs opacity-90">One tap · creates a sales lead · this job stays as is</div>
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

      <Sheet open={saleOpen} onOpenChange={setSaleOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{saleDone ? "Sales lead created ✓" : "New quote / installation"}</SheetTitle></SheetHeader>
          {saleDone ? (
            <div className="mt-3 space-y-3 text-sm" data-testid="sales-lead-created">
              <p>A sales rep gets the lead (the client's own rep, or the rep offer). This job stays as it is.</p>
              {leadId && <div><div className="mb-1 text-xs text-muted-foreground">Optional: add site photos for the rep</div><AddJobPhotosButton leadId={leadId} defaultType="site" /></div>}
              <Button className="w-full" onClick={() => setSaleOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted-foreground">Creates a New sale lead straight away for this client and address. No approval needed.</p>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, e.g. wants a unit in the main bedroom" rows={3} data-testid="sales-flag-note" />
              <Button className="h-11 w-full bg-[#C2410C] text-white hover:bg-[#9A3412]" disabled={busy} onClick={sendSale}>Create sales lead</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
