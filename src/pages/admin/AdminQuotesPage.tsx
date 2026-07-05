import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import QuotesList from "@/components/quoting/QuotesList";
import QuoteBuilder from "@/components/quoting/QuoteBuilder";

const AdminQuotesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"list" | "builder">("list");
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);
  const [presetLeadId, setPresetLeadId] = useState<string | null>(null);
  const [presetCustomerId, setPresetCustomerId] = useState<string | null>(null);
  const [presetTemplateId, setPresetTemplateId] = useState<string | null>(null);
  const [presetQuoteName, setPresetQuoteName] = useState<string | null>(null);
  const navigate = useNavigate();

  // Auto-open builder if any prefill params are in URL
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    const customerId = searchParams.get("customerId");
    const templateId = searchParams.get("templateId");
    const quoteName = searchParams.get("quoteName");
    if (leadId || customerId || templateId) {
      setPresetLeadId(leadId);
      setPresetCustomerId(customerId);
      setPresetTemplateId(templateId);
      setPresetQuoteName(quoteName);
      setEditQuoteId(null);
      setView("builder");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const clearPresets = () => {
    setEditQuoteId(null);
    setPresetLeadId(null);
    setPresetCustomerId(null);
    setPresetTemplateId(null);
    setPresetQuoteName(null);
  };

  return (
    <>
      {view === "list" ? (
        <QuotesList
          onCreateNew={() => {
            clearPresets();
            setView("builder");
          }}
          onEditQuote={(id) => {
            clearPresets();
            setEditQuoteId(id);
            setView("builder");
          }}
        />
      ) : (
        <QuoteBuilder
          quoteId={editQuoteId}
          leadId={presetLeadId}
          customerId={presetCustomerId}
          templateId={presetTemplateId}
          initialQuoteName={presetQuoteName}
          onBack={() => {
            clearPresets();
            setView("list");
          }}
        />
      )}

      {/* Floating button to open full-page Quote Builder */}
      <Button
        onClick={() => navigate("/admin/quote-builder")}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all"
        size="icon"
        title="Open Quote Builder"
      >
        <PenTool className="h-5 w-5" />
      </Button>
    </>
  );
};

export default AdminQuotesPage;
