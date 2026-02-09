import { useState } from "react";
import QuotesList from "@/components/quoting/QuotesList";
import QuoteBuilder from "@/components/quoting/QuoteBuilder";

const AdminQuotesPage = () => {
  const [view, setView] = useState<"list" | "builder">("list");
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);

  return view === "list" ? (
    <QuotesList
      onCreateNew={() => {
        setEditQuoteId(null);
        setView("builder");
      }}
      onEditQuote={(id) => {
        setEditQuoteId(id);
        setView("builder");
      }}
    />
  ) : (
    <QuoteBuilder
      quoteId={editQuoteId}
      onBack={() => {
        setEditQuoteId(null);
        setView("list");
      }}
    />
  );
};

export default AdminQuotesPage;
