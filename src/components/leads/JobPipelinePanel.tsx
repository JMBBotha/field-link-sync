import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package } from "lucide-react";

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

/** Converts a timestamptz to the value format required by <input type="datetime-local"> */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  leadId: string;
  initial: JobPipelineFields;
  onSaved?: (fields: JobPipelineFields) => void;
}

const JobPipelinePanel = ({ leadId, initial, onSaved }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [orderStatus, setOrderStatus] = useState(initial.order_status ?? NONE);
  const [partsStatus, setPartsStatus] = useState(initial.parts_status ?? NONE);
  const [technicianName, setTechnicianName] = useState(initial.technician_name ?? "");
  const [eta, setEta] = useState(toLocalInput(initial.technician_eta));

  useEffect(() => {
    setOrderStatus(initial.order_status ?? NONE);
    setPartsStatus(initial.parts_status ?? NONE);
    setTechnicianName(initial.technician_name ?? "");
    setEta(toLocalInput(initial.technician_eta));
  }, [initial.order_status, initial.parts_status, initial.technician_name, initial.technician_eta]);

  const handleSave = async () => {
    setSaving(true);
    const payload: JobPipelineFields = {
      order_status: orderStatus === NONE ? null : orderStatus,
      parts_status: partsStatus === NONE ? null : partsStatus,
      technician_name: technicianName.trim() || null,
      technician_eta: eta ? new Date(eta).toISOString() : null,
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
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Job pipeline</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Order status</Label>
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
          <Label className="text-[10px] text-muted-foreground">Parts status</Label>
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
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Technician name</Label>
        <Input
          value={technicianName}
          onChange={(e) => setTechnicianName(e.target.value)}
          placeholder="e.g. Sipho Ndlovu"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Technician ETA</Label>
        <Input
          type="datetime-local"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      <Button size="sm" className="w-full h-8 text-xs" onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
        Save pipeline
      </Button>
    </div>
  );
};

export default JobPipelinePanel;
