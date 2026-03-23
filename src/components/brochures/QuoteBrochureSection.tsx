import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paperclip, Plus, Eye, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuoteBrochures } from "@/hooks/useQuoteBrochures";
import { supabase } from "@/integrations/supabase/client";

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
  const [showPicker, setShowPicker] = useState(false);

  const {
    attachedBrochures,
    allBrochures,
    loading,
    addManualBrochure,
    removeBrochure,
  } = useQuoteBrochures({ quoteId, lineItemModelCodes });

  const getPublicUrl = (path: string) => {
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("product-brochures").getPublicUrl(path);
    return data.publicUrl;
  };

  const attachedIds = new Set(attachedBrochures.map((a) => a.brochure?.id).filter(Boolean));
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

      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Loading...</p>
      ) : attachedBrochures.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No matching brochures. Add products to auto-attach relevant brochures.
        </p>
      ) : (
        <div className="space-y-1">
          {attachedBrochures.map((item) => {
            const b = item.brochure;
            if (!b) return null;
            return (
              <div key={item.linkId || b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
                <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 font-medium">{b.name}</span>
                <Badge variant="outline" className={`text-[9px] ${brandColor[b.brand] || ""}`}>
                  {b.brand}
                </Badge>
                {!item.isAutoMatched && (
                  <Badge variant="secondary" className="text-[8px]">manual</Badge>
                )}
                <a href={getPublicUrl(b.file_url)} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </a>
                {item.linkId && (
                  <button onClick={() => removeBrochure(item.linkId)}>
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
                  onClick={async () => {
                    await addManualBrochure(b.id);
                    setShowPicker(false);
                  }}
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
