import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import QuotesList from "@/components/quoting/QuotesList";

/**
 * Quotes list page. Every "Open quote" / "New quote" action routes to the
 * unified builder at `/admin/quote-builder` — the single write surface.
 * No local builder is rendered here.
 */
const AdminQuotesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // If arriving with prefill params (from Lead / Customer / template links),
  // forward them straight to the unified builder so we never render a legacy
  // builder shell that could double-write.
  useEffect(() => {
    const leadId = searchParams.get("leadId");
    const customerId = searchParams.get("customerId");
    const templateId = searchParams.get("templateId");
    const quoteName = searchParams.get("quoteName");
    if (leadId || customerId || templateId || quoteName) {
      const q = new URLSearchParams();
      if (leadId) q.set("leadId", leadId);
      if (customerId) q.set("customerId", customerId);
      if (templateId) q.set("templateId", templateId);
      if (quoteName) q.set("quoteName", quoteName);
      setSearchParams({}, { replace: true });
      navigate(`/admin/quote-builder?${q.toString()}`, { replace: true });
    }
  }, [searchParams, setSearchParams, navigate]);

  return (
    <>
      <QuotesList
        onCreateNew={() => navigate("/admin/quote-builder")}
        onEditQuote={(id) => navigate(`/admin/quote-builder?quoteId=${id}`)}
      />

    </>
  );
};

export default AdminQuotesPage;
