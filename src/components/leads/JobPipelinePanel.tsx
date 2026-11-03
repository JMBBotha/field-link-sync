import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package, UserRound } from "lucide-react";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import { pipelineTechLine, partsApply } from "@/lib/pipelinePanel";

export interface JobPipelineFields {
  order_status?: string | null;
  parts_status?: string | null;
  technician_name?: string | null;
  technician_eta?: string | null;
}

const ORDER_STATUS_OPTIONS = ["not_ordered", "ordered", "in_stock", "delivered"];
const PARTS_STATUS_OPTIONS = ["pending", "in_stock", "backordered"];
const NONE = "__none__";

const label = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

interface Props {
  leadId: string;
  initial: JobPipelineFields;
  /** Johan 3 Nov 14:46: one source of truth: the lead's assigned tech + booked time, not free text. */
  assignedName?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  onSaved?: (fields: JobPipelineFields) => void;
}

const JobPipelinePanel = ({ leadId, initial, assignedName, scheduledDate, scheduledTime, onSaved }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [orderStatus, setOrderStatus] = useState(initial.order_status ?? NONE);
  const [partsStatus, setPartsStatus] = useState(initial.parts_status ?? NONE);
  const [needsParts, setNeedsParts] = useState(partsApply(initial));
  const [assignOpen, setAssignOpen] = useState(false);
  const tech = pipelineTechLine(assignedName, scheduledDate, scheduledTime);

  useEffect(() => {
    setOrderStatus(initial.order_status ?? NONE);
    setPartsStatus(initial.parts_status ?? NONE);
    setNeedsParts(partsApply(initial));
  }, [initial.order_status, initial.parts_status]);

  const handleSave = async () => {
    setSaving(true);
    const payload: JobPipelineFields = {
      order_status: !needsParts || orderStatus === NONE ? null : orderStatus,
      parts_status: !needsParts || partsStatus === NONE ? null : partsStatus,
    };

    const { error } = await supabase.from("leads").update(payload).eq("id", leadId);
    setSaving(false);

    if (error) {
      toast({ title: "Error", description: "Failed to update job pipeline", variant: "destructive" });
      return;
    }
    toast({ title: "Pipeline updated", description: "Job status details saved" });
    onSaved?.(payload);
  };

  return (
    <div
      className="p-2.5 rounded-md bg-muted/40 border border-border/40 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Job pipeline</p>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-background/60 p-2" data-testid="pipeline-tech">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-xs">
          {tech ? (<><p className="font-semibold truncate">{tech.name}</p><p className="text-muted-foreground">{tech.when}</p></>)
            : <p className="text-muted-foreground">No technician yet</p>}
        </div>
        <Button type="button" size="sm" variant={tech ? "outline" : "default"} className="h-8 text-xs" onClick={() => setAssignOpen(true)} data-testid="pipeline-assign">
          {tech ? "Change" : "Assign tech"}
        </Button>
      </div>

      <label className="flex items-center justify-between text-xs" data-testid="pipeline-parts-toggle">
        <span className="text-muted-foreground">{needsParts ? "Parts needed for this job" : "No parts needed"}</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setNeedsParts(!needsParts)}>{needsParts ? "No parts needed" : "Parts needed"}</Button>
      </label>

      {needsParts && <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Order status</Label>
          <Select value={orderStatus} onValueChange={setOrderStatus}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent className="z-50 bg-popover">
              <SelectItem value={NONE} className="text-xs">Not set</SelectItem>
              {ORDER_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o} value={o} className="text-xs">{label(o)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Parts status</Label>
          <Select value={partsStatus} onValueChange={setPartsStatus}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent className="z-50 bg-popover">
              <SelectItem value={NONE} className="text-xs">Not set</SelectItem>
              {PARTS_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o} value={o} className="text-xs">{label(o)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>}

      <Button size="sm" className="w-full h-8 text-xs" onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
        Save pipeline
      </Button>
      <LeadAssignDialog leadId={assignOpen ? leadId : null} onClose={() => setAssignOpen(false)} />
    </div>
  );
};

export default JobPipelinePanel;
