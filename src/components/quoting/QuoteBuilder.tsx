/**
 * QuoteBuilder — legacy shim.
 *
 * The real Quote Builder now lives at /admin/quote-builder and is backed by
 * the unified quote_items + quote_areas schema (see QuoteContext and
 * AdminQuoteBuilderPageUnified). This shim exists only so any lingering
 * imports keep compiling; on mount it redirects to the unified builder,
 * preserving the same props (quoteId / leadId / customerId / templateId).
 *
 * DO NOT reintroduce writes to `quote_line_items` here — the DB has
 * revoked INSERT/UPDATE/DELETE on that table for `authenticated`.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

interface QuoteBuilderProps {
  quoteId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  templateId?: string | null;
  initialQuoteName?: string | null;
  onBack?: () => void;
}

const QuoteBuilder = ({ quoteId, leadId, customerId, templateId, initialQuoteName }: QuoteBuilderProps) => {
  const navigate = useNavigate();

  useEffect(() => {
    const q = new URLSearchParams();
    if (quoteId) q.set("quoteId", quoteId);
    if (leadId) q.set("leadId", leadId);
    if (customerId) q.set("customerId", customerId);
    if (templateId) q.set("templateId", templateId);
    if (initialQuoteName) q.set("quoteName", initialQuoteName);
    const qs = q.toString();
    navigate(`/admin/quote-builder${qs ? `?${qs}` : ""}`, { replace: true });
  }, [quoteId, leadId, customerId, templateId, initialQuoteName, navigate]);

  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
};

export default QuoteBuilder;
