import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import QuotesList from "@/components/quoting/QuotesList";
import QuoteBuilder from "@/components/quoting/QuoteBuilder";

const AdminQuotesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"list" | "builder">("list");
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);
  const [presetLeadId, setPresetLeadId] = useState<string | null>(null);

  // Auto-open builder if leadId is in URL params
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (leadId) {
      setPresetLeadId(leadId);
      setEditQuoteId(null);
      setView("builder");
      // Clean up URL
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return view === "list" ? (
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
  );
};

export default AdminQuotesPage;
