import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { jhbLocalToIso } from "@/lib/jobActionBar";

const jhb = (iso: string | null | undefined, kind: "date" | "time") => {
  const d = iso ? new Date(iso) : new Date();
  return kind === "date"
    ? d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
    : d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
};

function useRefresh(jobId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["job-detail", jobId] });
    qc.invalidateQueries({ queryKey: ["job-activity", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
}

/** Admin: mark a job completed at a past date/time. Quiet (backfill rule): no client or rep alerts. Logged. */
export function MarkCompletedDialog({ jobId, open, onOpenChange, suggestedAt }:
  { jobId: string; open: boolean; onOpenChange: (o: boolean) => void; suggestedAt?: string | null }) {
  const { toast } = useToast();
  const refresh = useRefresh(jobId);
  const past = suggestedAt && new Date(suggestedAt) < new Date() ? suggestedAt : null;
  const [date, setDate] = useState(jhb(past, "date"));
  const [time, setTime] = useState(jhb(past, "time"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const at = jhbLocalToIso(date, time);
    if (!at) { toast({ title: "Pick a date and time", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await (supabase.rpc as any)("admin_mark_job_completed", { p_job: jobId, p_at: at, p_note: note || null });
    setBusy(false);
    if (error) { toast({ title: "Couldn't mark completed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Job marked completed", description: "No client or rep alerts were sent." });
    refresh(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mark-completed-dialog">
        <DialogHeader>
          <DialogTitle>Mark job completed</DialogTitle>
          <DialogDescription>When was the work finished? This is logged. No client or rep alerts are sent, and the balance invoice is not raised automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="block" htmlFor="mc-date">Date</Label><Input id="mc-date" type="date" value={date} max={jhb(null, "date")} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label className="block" htmlFor="mc-time">Time</Label><TimeInput24 id="mc-time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="mc-note">Note (optional)</Label><Textarea id="mc-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Installed on the day, tech forgot to close it" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={save} disabled={busy} data-testid="mark-completed-save">
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Mark completed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Admin: reopen a completed job. Logged; quiet. */
export function ReopenJobDialog({ jobId, open, onOpenChange }: { jobId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const refresh = useRefresh(jobId);
  const [status, setStatus] = useState<"in_progress" | "scheduled">("in_progress");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("admin_reopen_job", { p_job: jobId, p_status: status, p_note: note || null });
    setBusy(false);
    if (error) { toast({ title: "Couldn't reopen", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Job reopened" });
    refresh(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="reopen-dialog">
        <DialogHeader><DialogTitle>Reopen job</DialogTitle><DialogDescription>The completed date is cleared. This is logged.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["in_progress", "scheduled"] as const).map((s) => (
            <Button key={s} variant={status === s ? "default" : "outline"} className="min-h-[44px]" onClick={() => setStatus(s)}>{s === "in_progress" ? "In progress" : "Scheduled"}</Button>
          ))}
        </div>
        <div className="space-y-1"><Label htmlFor="ro-note">Reason (optional)</Label><Textarea id="ro-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Reopen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
