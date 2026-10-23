import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import DurationPicker from "@/components/scheduling/DurationPicker";
import { DEFAULT_JOB_MINUTES, intervalToMinutes, minutesToInterval } from "@/lib/schedulingDefaults";
import { formatDuration } from "@/lib/durationOptions";

/** Click-to-edit job length (interval column) using the shared chips + half-hour stepper. */
export const EditableDuration = ({ label, value, saving, disabled, onSave, className, startTime }: {
  label: string; value: any; saving?: boolean; disabled?: boolean; className?: string;
  onSave: (v: any) => Promise<any> | void; startTime?: string | null;
}) => {
  const current = intervalToMinutes(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number>(current ?? DEFAULT_JOB_MINUTES);

  const commit = async () => {
    setEditing(false);
    if (draft === current) return;
    try { await onSave(minutesToInterval(draft)); toast({ title: `${label} saved` }); } catch { /* editor reverts */ }
  };

  return (
    <div className={cn("min-w-0", editing && "col-span-2", className)} data-testid="editable-duration">
      <p className="text-muted-foreground text-xs flex items-center gap-1">{label}{saving && <Loader2 className="h-3 w-3 animate-spin" />}</p>
      {editing ? (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <DurationPicker label="Length" value={draft} onChange={setDraft} startTime={startTime ?? null} />
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setDraft(current ?? DEFAULT_JOB_MINUTES); setEditing(false); }}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="button" size="sm" className="h-8 gap-1" onClick={commit}><Check className="h-4 w-4" /> Save</Button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => { setDraft(current ?? DEFAULT_JOB_MINUTES); setEditing(true); }}
          className="group flex w-full items-center gap-1 rounded px-1 -mx-1 py-0.5 text-left font-medium text-sm hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent">
          <span className="truncate">{current ? formatDuration(current) : "—"}</span>
          {!disabled && <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />}
        </button>
      )}
    </div>
  );
};

export default EditableDuration;
