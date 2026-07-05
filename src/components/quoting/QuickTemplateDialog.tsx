import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileText, Search, ArrowRight, Sparkles } from "lucide-react";

interface QuickTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional lead to associate with the new quote */
  leadId?: string | null;
  /** Optional customer to prefill on the new quote */
  customerId?: string | null;
  /** Optional pre-filled quote name/notes */
  quoteName?: string;
}

/**
 * Quick Template picker → routes to /admin/quotes with params so the
 * QuoteBuilder pre-fills line items, terms & customer in one shot.
 */
const QuickTemplateDialog = ({
  open,
  onClose,
  leadId,
  customerId,
  quoteName,
}: QuickTemplateDialogProps) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["quote-templates", "quick-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_templates")
        .select("id, name, description, category, line_items")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t: any) =>
      [t.name, t.description, t.category].some((f) =>
        String(f || "").toLowerCase().includes(q)
      )
    );
  }, [templates, search]);

  const buildUrl = (templateId?: string) => {
    const params = new URLSearchParams();
    if (templateId) params.set("templateId", templateId);
    if (leadId) params.set("leadId", leadId);
    if (customerId) params.set("customerId", customerId);
    if (quoteName) params.set("quoteName", quoteName);
    return `/admin/quotes?${params.toString()}`;
  };

  const go = (templateId?: string) => {
    onClose();
    navigate(buildUrl(templateId));
  };

  const itemCount = (t: any) =>
    Array.isArray(t?.line_items) ? t.line_items.length : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Quick Quote from Template
          </DialogTitle>
          <DialogDescription>
            Pick a template — customer, line items and terms will be pre-filled.
            You just review and send.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="pl-9"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading templates…
            </p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-muted-foreground">
                {templates.length === 0
                  ? "No templates yet. Save one from the Quote Builder."
                  : "No templates match your search."}
              </p>
            </div>
          ) : (
            filtered.map((t: any) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className="group w-full text-left rounded-xl border border-border bg-card hover:border-primary hover:shadow-sm transition-all p-3 flex items-start gap-3 border-l-4 border-l-accent-yellow/70 hover:border-l-accent-yellow"
              >
                <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {t.name}
                    </span>
                    {t.category && (
                      <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {t.category}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                      {t.description}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {itemCount(t)} line item{itemCount(t) === 1 ? "" : "s"}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1" />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Prefer to start from scratch?
          </p>
          <Button variant="ghost" size="sm" onClick={() => go(undefined)}>
            Skip — blank quote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickTemplateDialog;
