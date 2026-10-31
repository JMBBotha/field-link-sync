import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Loader2 } from "lucide-react";
import { jhbLocalToIso } from "@/lib/jobActionBar";
import { editableJobFields, type UnitRow } from "@/lib/jobEdit";

const jhb = (iso: string | null | undefined, kind: "date" | "time") => {
  if (!iso) return kind === "date" ? "" : "08:00";
  const d = new Date(iso);
  return kind === "date" ? d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
    : d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
};

type Props = {
  open: boolean; onOpenChange: (o: boolean) => void;
  jobId: string; companyId: string; scheduledFor: string | null; techId: string | null;
  perms: { admin: boolean; rep: boolean };
};

/** Edit job details. Admin: everything. Client's rep: date/time + notes. Server re-checks (update_job_details). */
export default function EditJobDetailsSheet({ open, onOpenChange, jobId, companyId, scheduledFor, techId, perms }: Props) {
  const f = editableJobFields(perms);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(jhb(scheduledFor, "date"));
  const [time, setTime] = useState(jhb(scheduledFor, "time"));
  const [tech, setTech] = useState(techId ?? "");
  const [note, setNote] = useState("");
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const techs = useQuery({
    queryKey: ["dispatchable-techs", companyId], enabled: open && f.tech,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("dispatchable_technicians", { _company_id: companyId });
      if (error) throw error;
      return ((data ?? []) as any[]).map((t) => ({ id: (t.id ?? t.profile_id) as string, name: (t.full_name ?? t.name ?? "Technician") as string }));
    },
  });
  const unitQ = useQuery({
    queryKey: ["job-units-edit", jobId], enabled: open && f.units,
    queryFn: async () => {
      const { data, error } = await (supabase.from("job_unit_details" as any) as any)
        .select("id, unit_label, position, brand, model, serial_number").eq("job_id", jobId).order("created_at");
      if (error) throw error;
      return (data ?? []) as UnitRow[];
    },
  });
  const rows = units ?? unitQ.data ?? [];
  const setUnit = (i: number, k: keyof UnitRow, v: string) => setUnits(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const save = async () => {
    const at = date ? jhbLocalToIso(date, time) : null;
    if (date && !at) { toast({ title: "Check the date and time", variant: "destructive" }); return; }
    const changedUnits = f.units && units ? units.filter((u) => {
      const o = unitQ.data?.find((x) => x.id === u.id);
      return o && (["unit_label", "position", "brand", "model", "serial_number"] as const).some((k) => (o[k] ?? "") !== (u[k] ?? ""));
    }) : [];
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("update_job_details", {
      p_job: jobId,
      p_scheduled_for: at && at !== (scheduledFor ? new Date(scheduledFor).toISOString() : null) ? at : null,
      p_tech: f.tech && tech && tech !== techId ? tech : null,
      p_note: note.trim() || null,
      p_units: changedUnits.length ? changedUnits : null,
    });
    setBusy(false);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); return; }
    const n = Object.keys(data ?? {}).length;
    toast({ title: n ? "Job updated" : "Nothing changed" });
    ["job-detail", "job-detail-tech", "job-activity", "job-units-edit"].forEach((k) => qc.invalidateQueries({ queryKey: [k, jobId] }));
    qc.invalidateQueries({ queryKey: ["jobs"] });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl" data-testid="edit-job-sheet">
        <SheetHeader className="text-left">
          <SheetTitle>Edit job details</SheetTitle>
          <SheetDescription>{f.tech ? "Every change is logged on the job timeline." : "You can change the date, time and add notes. Changes are logged."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="block" htmlFor="ej-date">Installation date</Label><Input id="ej-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label className="block" htmlFor="ej-time">Time</Label><TimeInput24 id="ej-time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          {f.tech && (
            <div className="space-y-1">
              <Label className="block" htmlFor="ej-tech">Technician</Label>
              <select id="ej-tech" className="w-full min-h-[44px] rounded-md border bg-background px-3 text-sm" value={tech} onChange={(e) => setTech(e.target.value)} data-testid="edit-job-tech">
                <option value="">{techId ? "Keep current tech" : "No tech yet"}</option>
                {(techs.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {f.units && rows.length > 0 && (
            <div className="space-y-2">
              <Label className="block">Units</Label>
              {rows.map((u, i) => (
                <div key={u.id} className="rounded-xl border p-3 grid grid-cols-2 gap-2">
                  <Input aria-label="Label" placeholder="Label" value={u.unit_label ?? ""} onChange={(e) => setUnit(i, "unit_label", e.target.value)} />
                  <select aria-label="Position" className="min-h-[40px] rounded-md border bg-background px-2 text-sm" value={u.position ?? "indoor"} onChange={(e) => setUnit(i, "position", e.target.value)}>
                    <option value="indoor">Indoor</option><option value="outdoor">Outdoor</option>
                  </select>
                  <Input aria-label="Brand" placeholder="Brand" value={u.brand ?? ""} onChange={(e) => setUnit(i, "brand", e.target.value)} />
                  <Input aria-label="Model" placeholder="Model" value={u.model ?? ""} onChange={(e) => setUnit(i, "model", e.target.value)} />
                  <Input aria-label="Serial" placeholder="Serial number" className="col-span-2" value={u.serial_number ?? ""} onChange={(e) => setUnit(i, "serial_number", e.target.value)} />
                </div>
              ))}
            </div>
          )}
          {f.units && rows.length === 0 && !unitQ.isLoading && <p className="text-xs text-muted-foreground">No units recorded yet. Add them in “Backfill for tech”.</p>}
          <div className="space-y-1"><Label className="block" htmlFor="ej-note">Add a note</Label><Textarea id="ej-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shows on the job timeline" /></div>
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-background pt-2 pb-[max(env(safe-area-inset-bottom),8px)]">
          <Button variant="outline" className="min-h-[48px]" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="min-h-[48px]" onClick={save} disabled={busy} data-testid="edit-job-save">{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
