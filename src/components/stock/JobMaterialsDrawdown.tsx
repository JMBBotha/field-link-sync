import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { sb } from "@/components/supplierDocs/api";
import { buildDrawPlan, toDrawPayload } from "@/lib/materialsDrawdown";
import DrawdownTable from "./DrawdownTable";

/** Materials used on this job, prefilled from the quote. Admin or the assigned tech. Prompted, never automatic. */
export default function JobMaterialsDrawdown({ jobId }: { jobId: string }) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const { data: plan, refetch, error } = useQuery({ queryKey: ["job-materials-plan", jobId], retry: false,
    queryFn: async () => { const { data, error } = await sb.rpc("job_materials_plan", { p_job: jobId }); if (error) throw error; return data; } });
  const rows = useMemo(() => (plan ? buildDrawPlan(plan.items ?? [], plan.stock ?? [], plan.drawn ?? [], plan.reserved ?? []) : []), [plan]);
  if (error || !rows.length) return null;
  const payload = toDrawPayload(rows, qty);
  const save = async () => {
    setSaving(true);
    const { data, error } = await sb.rpc("job_materials_draw", { p_job: jobId, p_lines: payload });
    setSaving(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    const short = (data?.lines ?? []).filter((l: any) => l.note);
    toast({ title: "Materials recorded", description: short.length ? short.map((l: any) => l.note).join("; ") : undefined });
    setQty({}); refetch();
  };
  return <MaterialsCard rows={rows} qty={qty} onQty={(k, v) => setQty((q) => ({ ...q, [k]: v }))} onSave={save} saving={saving} count={payload.length} />;
}

export function MaterialsCard({ rows, qty, onQty, onSave, saving, count }: { rows: ReturnType<typeof buildDrawPlan>; qty: Record<string, number>; onQty: (k: string, v: number) => void; onSave: () => void; saving: boolean; count: number }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div><h3 className="font-semibold">Materials used</h3><p className="text-xs text-muted-foreground">From the quote. Change anything you used more or less of. When an install allowance is active, finishing the job applies that allowance. You do not enter prices.</p></div>
        <DrawdownTable rows={rows} qty={qty} onQty={onQty} />
        <div className="flex justify-end"><Button onClick={onSave} disabled={saving || !count}>{saving ? "Saving…" : `Take ${count} item${count === 1 ? "" : "s"} off stock`}</Button></div>
      </CardContent>
    </Card>
  );
}
