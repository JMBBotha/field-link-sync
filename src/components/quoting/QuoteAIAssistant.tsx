import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Plus, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Suggestion {
  description: string;
  quantity: number;
  unit_price: number;
  reasoning?: string;
}

interface QuoteAIAssistantProps {
  onAddItem: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const JOB_TYPES = [
  "Installation",
  "Repair",
  "Maintenance",
  "Duct Cleaning",
  "Gas Recharge",
  "Compressor Replacement",
  "General HVAC",
];

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const QuoteAIAssistant = ({ onAddItem }: QuoteAIAssistantProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState("");
  const [siteNotes, setSiteNotes] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [similarCount, setSimilarCount] = useState(0);

  const getSuggestions = async () => {
    if (!jobType) {
      toast({ title: "Select a job type first", variant: "destructive" });
      return;
    }
    setLoading(true);
    setSuggestions([]);
    try {
      const { data, error } = await supabase.functions.invoke("ai-suggest-quote", {
        body: { jobType, siteNotes },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSuggestions(data?.suggestions || []);
      setSimilarCount(data?.similar_quotes_count || 0);
    } catch (err: any) {
      toast({ title: "AI suggestions unavailable", description: err.message || "Try again later.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (s: Suggestion) => {
    onAddItem({ description: s.description, quantity: s.quantity, unit_price: s.unit_price });
    toast({ title: `Added: ${s.description}` });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Sparkles className="h-3.5 w-3.5" /> AI Suggestions
      </Button>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI Quote Assistant
          </CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-xs h-7">
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Job Type</Label>
            <Select value={jobType} onValueChange={setJobType}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {JOB_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Site Notes (optional)</Label>
            <Textarea
              value={siteNotes}
              onChange={(e) => setSiteNotes(e.target.value)}
              placeholder="E.g. 3-bedroom house, split unit..."
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        <Button type="button" size="sm" onClick={getSuggestions} disabled={loading} className="w-full gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? "Generating..." : "Get AI Suggestions"}
        </Button>

        {suggestions.length > 0 && (
          <div className="space-y-2">
            {similarCount > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" /> Based on {similarCount} similar past quotes
              </p>
            )}
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-background border text-sm">
                <div className="flex-1 min-w-0 mr-2">
                  <p className="font-medium truncate">{s.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Qty: {s.quantity} × {formatZAR(s.unit_price)} = {formatZAR(s.quantity * s.unit_price)}
                  </p>
                  {s.reasoning && <p className="text-xs text-muted-foreground mt-0.5 italic">{s.reasoning}</p>}
                </div>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => handleAdd(s)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default QuoteAIAssistant;
