import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Clock, Images, Package, Loader2, WifiOff } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { useJobCompletion } from "@/hooks/useJobCompletion";
import SignaturePad from "./SignaturePad";

interface JobCompletionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  jobId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  onCompleted?: () => void;
}

const currency = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);

const JobCompletionSheet = ({
  open,
  onOpenChange,
  leadId,
  jobId,
  customerName,
  customerEmail,
  onCompleted,
}: JobCompletionSheetProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineContext();
  const { submit } = useJobCompletion();

  const [summary, setSummary] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(customerName || "");
  const [signerEmail, setSignerEmail] = useState(customerEmail || "");
  const [saving, setSaving] = useState(false);

  const { data: parts = [] } = useQuery({
    queryKey: ["job-used-parts", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_used_parts" as never)
        .select("id, product_name, quantity, line_total")
        .eq("lead_id", leadId);
      if (error) throw error;
      return (data || []) as unknown as Array<{
        id: string;
        product_name: string;
        quantity: number;
        line_total: number;
      }>;
    },
    enabled: open && !!leadId && isOnline,
  });

  const { data: photoCount = 0 } = useQuery({
    queryKey: ["job-photo-count", leadId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("job_photos" as never)
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: open && !!leadId && isOnline,
  });

  const { data: labourMinutes = 0 } = useQuery({
    queryKey: ["job-labour-minutes", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_time_entries" as never)
        .select("duration_minutes")
        .eq("lead_id", leadId);
      if (error) throw error;
      return (data || []).reduce(
        (sum: number, r: { duration_minutes?: number | null }) => sum + (r.duration_minutes || 0),
        0
      );
    },
    enabled: open && !!leadId && isOnline,
  });

  const partsTotal = useMemo(
    () => parts.reduce((sum, p) => sum + Number(p.line_total || 0), 0),
    [parts]
  );

  const canSubmit = !!signature && summary.trim().length >= 3 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { queued } = await submit({
        leadId,
        jobId,
        workSummary: summary.trim(),
        customerName: signerName || customerName,
        customerEmail: signerEmail || customerEmail,
        signatureDataUrl: signature,
        partsTotal,
        labourMinutes,
        photoCount,
      });
      if (!queued) {
        toast({ title: "Job completed", description: "Signed off and ready for invoicing." });
      }
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      onCompleted?.();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not complete job",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-4">
        <SheetHeader className="mb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Complete job on site
          </SheetTitle>
        </SheetHeader>

        {!isOnline && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <WifiOff className="h-4 w-4" />
            Offline — completion will be queued and synced automatically.
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border p-2 text-center">
              <Package className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-xs font-medium">{parts.length} parts</p>
              <p className="text-[10px] text-muted-foreground">{currency(partsTotal)}</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-xs font-medium">{labourMinutes} min</p>
              <p className="text-[10px] text-muted-foreground">labour</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <Images className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1 text-xs font-medium">{photoCount} photos</p>
              <p className="text-[10px] text-muted-foreground">attached</p>
            </div>
          </div>

          {parts.length > 0 && (
            <div className="space-y-1">
              {parts.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    {p.product_name} <Badge variant="secondary">x{p.quantity}</Badge>
                  </span>
                  <span className="text-muted-foreground">{currency(Number(p.line_total))}</span>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="work-summary">Work performed</Label>
            <Textarea
              id="work-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the work completed on site…"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="signer-name">Signed off by</Label>
              <Input
                id="signer-name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Customer name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signer-email">Email (for copy)</Label>
              <Input
                id="signer-email"
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Customer signature</Label>
            <SignaturePad value={signature} onChange={setSignature} />
          </div>

          <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Complete &amp; sign off
          </Button>
          {!canSubmit && !saving && (
            <p className="text-center text-xs text-muted-foreground">
              A work summary and customer signature are required.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default JobCompletionSheet;
