import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";

type Intent = "sales" | "service";

interface Props {
  leadId: string;
}

/**
 * Human override for the automatic lead classification.
 * Shows what the rule/AI classifier decided and lets an operator
 * correct the intent — the override is stored with classified_by = 'human'.
 */
const LeadClassificationPanel = ({ leadId }: Props) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<{
    intents: string[];
    primary_intent: Intent | null;
    confidence: number | null;
    classified_by: string | null;
    lead_priority: string | null;
    lead_score: number | null;
    lead_status: string | null;
    source: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: row } = await supabase
        .from("leads")
        .select("intents, primary_intent, confidence, classified_by, lead_priority, lead_score, lead_status, source")
        .eq("id", leadId)
        .maybeSingle();
      if (active) {
        setData(row as any);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [leadId]);

  const override = async (intent: Intent) => {
    setSaving(true);
    const intents = Array.from(new Set([...(data?.intents ?? []), intent]));
    const { error } = await supabase
      .from("leads")
      .update({
        primary_intent: intent,
        intents,
        confidence: 1,
        classified_by: "human",
        lead_status: "classified",
      } as any)
      .eq("id", leadId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not update classification", description: error.message, variant: "destructive" });
      return;
    }
    setData((d) => (d ? { ...d, primary_intent: intent, intents, confidence: 1, classified_by: "human" } : d));
    toast({ title: `Marked as ${intent}` });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/60 p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading classification…
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Classification
        </h3>
        {data.classified_by && (
          <span className="text-[10px] text-muted-foreground">
            by {data.classified_by}
            {data.confidence != null ? ` · ${Math.round(Number(data.confidence) * 100)}%` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(data.intents ?? []).length === 0 && (
          <span className="text-xs text-muted-foreground">Not classified yet</span>
        )}
        {(data.intents ?? []).map((i) => (
          <Badge key={i} variant={i === data.primary_intent ? "default" : "secondary"} className="capitalize">
            {i}
            {i === data.primary_intent ? " · primary" : ""}
          </Badge>
        ))}
        {data.lead_priority && (
          <Badge variant="outline" className="capitalize">{data.lead_priority.replace("_", " ")}</Badge>
        )}
        {data.lead_score != null && <Badge variant="outline">Score {data.lead_score}/5</Badge>}
        {data.source && <Badge variant="outline" className="capitalize">{data.source.replace(/_/g, " ")}</Badge>}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" disabled={saving} onClick={() => override("sales")}>
          Mark as sales
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" disabled={saving} onClick={() => override("service")}>
          Mark as service
        </Button>
      </div>
    </div>
  );
};

export default LeadClassificationPanel;
