import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLabourNorms } from "@/hooks/useLabourNorms";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";

/** Labour hour norms (master, global) — feed the "labour below norm" pricing chip only. */
export default function LabourNormsCard() {
  const { canWrite, isLoading } = useCanWriteMasterCatalog();
  const { data: norms = [] } = useLabourNorms();
  const qc = useQueryClient();
  const { toast } = useToast();
  if (isLoading || !canWrite) return null;

  const save = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase.from("labour_norms" as any) as any).update(patch).eq("id", id);
    if (error) toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["labour-norms"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Labour norms (hours)</CardTitle></CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">Used for the "labour below norm" check on quotes. Never blocks a quote.</p>
        {norms.map((n) => (
          <div key={n.id} className="grid grid-cols-[1fr_5rem] items-center gap-2">
            <Input className="h-8" defaultValue={n.label} aria-label="Norm label"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== n.label) void save(n.id, { label: v }); }} />
            <Input className="h-8 text-right" type="number" step="0.25" min="0" defaultValue={n.hours} aria-label={`Hours for ${n.label}`}
              onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== n.hours) void save(n.id, { hours: v }); }} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
