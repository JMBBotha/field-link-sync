import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import QuotesList from "@/components/quoting/QuotesList";

/**
 * Legacy /quotes route wrapper. Kept for existing links only — all builder
 * actions route to /admin/quote-builder (the single source of truth).
 */
const Quotes = () => {
  const navigate = useNavigate();

  // If the app is opened at /quotes directly, forward to the admin surface.
  useEffect(() => {
    // Only redirect if we're actually on /quotes (not embedded).
    if (window.location.pathname === "/quotes") {
      navigate("/admin/quotes", { replace: true });
    }
  }, [navigate]);

  return (
    <Layout>
      <QuotesList
        onCreateNew={() => navigate("/admin/quote-builder")}
        onEditQuote={(id) => navigate(`/admin/quote-builder?quoteId=${id}`)}
      />
    </Layout>
  );
};

export default Quotes;
