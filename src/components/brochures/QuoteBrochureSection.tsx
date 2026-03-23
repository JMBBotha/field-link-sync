import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paperclip, Plus, Eye, X } from "lucide-react";
import { matchBrochuresToQuote, type ProductBrochure } from "@/utils/brochureMatcher";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const brandColor: Record<string, string> = {
  Samsung: "bg-blue-100 text-blue-700 border-blue-300",
  Alliance: "bg-green-100 text-green-700 border-green-300",
  Comfee: "bg-orange-100 text-orange-700 border-orange-300",
};

interface QuoteBrochureSectionProps {
  quoteId?: string | null;
  lineItemModelCodes: string[];
}

const QuoteBrochureSection = ({ quoteId, lineItemModelCodes }: QuoteBrochureSectionProps) => {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  // Fetch all active brochures
  const { data: allBrochures = [] } = useQuery({
    queryKey: ["active-brochures"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_brochures" as any)
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as unknown as (ProductBrochure & { category?: string })[];
    },
  });

  // Fetch existing quote_brochures
  const { data: quoteBrochures = [] } = useQuery({
    queryKey: ["quote-brochures", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_brochures" as any)
        .select("*, product_brochures(*)" as any)
        .eq("quote_id", quoteId!);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Auto-match brochures
  const autoMatched = useMemo(
    () => matchBrochuresToQuote(lineItemModelCodes, allBrochures),
    [lineItemModelCodes, allBrochures]
  );

  // Sync auto-matched to DB when quoteId exists
  const upsertMutation = useMutation({
    mutationFn: async (brochureIds: string[]) => {
      if (!quoteId) return;
      // Remove old auto-matched
      await supabase
        .from("quote_brochures" as any)
        .delete()
        .eq("quote_id", quoteId)
        .eq("is_auto_matched", true);
      // Insert new
      if (brochureIds.length > 0) {
        await supabase.from("quote_brochures" as any).insert(
          brochureIds.map((bid, i) => ({
            quote_id: quoteId,
            brochure_id: bid,
            sort_order: i,
            is_auto_matched: true,
          })) as any
        );
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-brochures", quoteId] }),
  });

  useEffect(() => {
    if (quoteId && autoMatched.length >= 0) {
      upsertMutation.mutate(autoMatched.map((b) => b.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, autoMatched.map((b) => b.id).join(",")]);

  // Manually add a brochure
  const addManual = useMutation({
    mutationFn: async (brochureId: string) => {
      if (!quoteId) return;
      await supabase.from("quote_brochures" as any).upsert({
        quote_id: quoteId,
        brochure_id: brochureId,
        is_auto_matched: false,
      } as any, { onConflict: "quote_id,brochure_id" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote-brochures", quoteId] });
      setShowPicker(false);
    },
  });

  const removeBrochure = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("quote_brochures" as any).delete().eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote-brochures", quoteId] }),
  });

  // Combine auto-matched (when no quoteId) or use DB results
  const displayBrochures = quoteId
    ? quoteBrochures.map((qb: any) => ({
        linkId: qb.id,
        brochure: qb.product_brochures as ProductBrochure,
        isAuto: qb.is_auto_matched,
      }))
    : autoMatched.map((b) => ({ linkId: null, brochure: b, isAuto: true }));

  const getPublicUrl = (path: string) => {
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("product-brochures").getPublicUrl(path);
    return data.publicUrl;
  };

  const attachedIds = new Set(displayBrochures.map((d: any) => d.brochure?.id).filter(Boolean));
  const available = allBrochures.filter((b) => !attachedIds.has(b.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Product Brochures
          </span>
        </div>
        {quoteId && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setShowPicker(true)}>
            <Plus className="h-3 w-3 mr-0.5" /> Add
          </Button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground italic">Auto-attached to quote PDF based on model codes.</p>

      {displayBrochures.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No matching brochures. Add products to auto-attach relevant brochures.
        </p>
      ) : (
        <div className="space-y-1">
          {displayBrochures.map((item: any, idx: number) => {
            const b = item.brochure;
            if (!b) return null;
            return (
              <div key={item.linkId || b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
                <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 font-medium">{b.name}</span>
                <Badge variant="outline" className={`text-[9px] ${brandColor[b.brand] || ""}`}>
                  {b.brand}
                </Badge>
                <a href={getPublicUrl(b.file_url)} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </a>
                {item.linkId && (
                  <button onClick={() => removeBrochure.mutate(item.linkId)}>
                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Brochure</DialogTitle>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">All brochures already attached.</p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {available.map((b) => (
                <button
                  key={b.id}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted text-left text-sm"
                  onClick={() => addManual.mutate(b.id)}
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{b.name}</span>
                  <Badge variant="outline" className={`text-[9px] ${brandColor[b.brand] || ""}`}>
                    {b.brand}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuoteBrochureSection;
