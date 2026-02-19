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
  const navigate = useNavigate();

  // Auto-open builder if leadId is in URL params
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (leadId) {
      setPresetLeadId(leadId);
      setEditQuoteId(null);
      setView("builder");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <>
      {view === "list" ? (
        <QuotesList
          onCreateNew={() => {
            setEditQuoteId(null);
            setPresetLeadId(null);
            setView("builder");
          }}
          onEditQuote={(id) => {
            setEditQuoteId(id);
            setPresetLeadId(null);
            setView("builder");
          }}
        />
      ) : (
        <QuoteBuilder
          quoteId={editQuoteId}
          leadId={presetLeadId}
          onBack={() => {
            setEditQuoteId(null);
            setPresetLeadId(null);
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
