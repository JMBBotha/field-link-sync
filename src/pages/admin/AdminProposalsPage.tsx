import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Paperclip } from "lucide-react";
import ProposalBuilder from "@/components/proposals/ProposalBuilder";
import QuoteStatusBadge from "@/components/quoting/QuoteStatusBadge";
import BrochureManagement from "@/components/brochures/BrochureManagement";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const AdminProposalsPage = () => {
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes-for-proposals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name), proposal_sections(id)")
        .neq("status", "superseded")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (selectedQuoteId) {
    return <ProposalBuilder quoteId={selectedQuoteId} onBack={() => setSelectedQuoteId(null)} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="h-5 w-5" /> Templates
        </h2>
      </div>

      <Tabs defaultValue="proposals" className="w-full">
        <TabsList>
          <TabsTrigger value="proposals">
            <FileText className="h-3.5 w-3.5 mr-1" /> Proposal Templates
          </TabsTrigger>
          <TabsTrigger value="brochures">
            <Paperclip className="h-3.5 w-3.5 mr-1" /> Product Brochures
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proposals" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Select a quote to build or edit its visual proposal.
          </p>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : quotes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No quotes yet. Create a quote first to build a proposal.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {quotes.map((quote: any) => {
                const hasSections = quote.proposal_sections?.length > 0;
                return (
                  <Card
                    key={quote.id}
                    className="cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => setSelectedQuoteId(quote.id)}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-bold">{quote.quote_number}</span>
                            <QuoteStatusBadge status={quote.status} />
                            {hasSections && (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                                Proposal
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {quote.customers?.name || "No customer"}
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="font-bold">{formatZAR(Number(quote.total))}</p>
                          <Button variant="outline" size="sm" className="mt-1 text-xs">
                            {hasSections ? "Edit Proposal" : "Build Proposal"}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="brochures" className="mt-4">
          <BrochureManagement />
        </TabsContent>
      </Tabs>


    </div>
  );
};

export default AdminProposalsPage;
