import { useState } from "react";
import Layout from "@/components/Layout";
import QuotesList from "@/components/quoting/QuotesList";
import QuoteBuilder from "@/components/quoting/QuoteBuilder";

const Quotes = () => {
  const [view, setView] = useState<"list" | "builder">("list");
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);

  return (
    <Layout>
      {view === "list" ? (
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
      )}
    </Layout>
  );
};

export default Quotes;
