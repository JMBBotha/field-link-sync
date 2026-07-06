import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, FileText, Download, Link2, FileCheck2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ListSkeleton } from "@/components/ui/skeletons";
import { convertQuoteToInvoice } from "@/lib/convertQuoteToInvoice";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import QuoteStatusBadge from "./QuoteStatusBadge";

import { useToast } from "@/hooks/use-toast";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import HelpTip from "@/components/help/HelpTip";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface QuotesListProps {
  onCreateNew: () => void;
  onEditQuote: (id: string) => void;
}

const QuotesList = ({ onCreateNew, onEditQuote }: QuotesListProps) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [converting, setConverting] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleConvertToInvoice = async (quoteId: string) => {
    if (!user?.id) return;
    setConverting(quoteId);

    // Optimistic: flip status → accepted immediately in every ["quotes", ...] cache.
    const affected = qc.getQueriesData<any[]>({ queryKey: ["quotes"] });
    const snapshots = affected.map(([k, v]) => [k, v] as const);
    affected.forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      qc.setQueryData(
        k,
        list.map((q: any) => (q.id === quoteId ? { ...q, status: "accepted" } : q)),
      );
    });

    try {
      const invoiceId = await convertQuoteToInvoice(quoteId, user.id);
      toast({ title: "Invoice created", description: "Draft invoice generated from quote." });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/admin/invoices?highlight=${invoiceId}`);
    } catch (e: any) {
      // Rollback
      snapshots.forEach(([k, v]) => qc.setQueryData(k, v));
      toast({
        title: e.message || "Conversion failed",
        description: "Reverted the quote. Please try again.",
        variant: "destructive",
      });
    } finally {
      setConverting(null);
    }
  };



  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes", search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("quotes")
        .select("*, customers(name, phone)")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (search) {
        query = query.or(`quote_number.ilike.%${search}%,notes.ilike.%${search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const statuses = ["all", "draft", "sent", "viewed", "accepted", "declined"];

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="h-5 w-5" /> Quotes
          <HelpTip title="Quotes" side="bottom">
            Once a quote is <strong>Accepted</strong>, use the green <em>Convert to Invoice</em>
            icon on the row to generate a draft invoice with the same customer, location and line items.
          </HelpTip>
        </h2>
        <Button onClick={onCreateNew}>
          <Plus className="h-4 w-4 mr-2" /> New Quote
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {statuses.map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className="capitalize text-xs"
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : quotes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>No quotes yet. Create your first quote!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((quote: any) => (
            <Card
              key={quote.id}
              className="cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => onEditQuote(quote.id)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-primary">
                        {quote.quote_number || <span className="text-amber-600 dark:text-amber-400 text-xs">No number – draft</span>}
                      </span>
                      <QuoteStatusBadge status={quote.status} />
                    </div>
                    <p className="text-sm text-foreground/80 truncate">
                      {quote.customers?.name || "No customer"} <span className="text-muted-foreground">• {quote.customers?.phone || ""}</span>
                    </p>
                  </div>
                  <div className="text-right ml-4 flex flex-col items-end gap-1">
                    <p className="font-bold text-primary">{formatZAR(Number(quote.total))}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(quote.created_at).toLocaleDateString("en-ZA")}
                    </p>
                    <div className="flex gap-1 mt-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditQuote(quote.id);
                          toast({ title: "Open the quote to download PDF" });
                        }}
                        title="Download PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {quote.status === "accepted" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600 hover:text-green-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConvertToInvoice(quote.id);
                          }}
                          disabled={converting === quote.id}
                          title="Convert to Invoice"
                        >
                          {converting === quote.id ? <Spinner size="xs" /> : <FileCheck2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      {quote.public_token && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(`${window.location.origin}/quote/${quote.public_token}`);
                              toast({ title: "Link copied! 🔗" });
                            }}
                            title="Copy client link"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <WhatsAppShareButton
                            phone={quote.customers?.phone}
                            message={`Hi ${quote.customers?.name || "there"}, your quote ${quote.quote_number} for ${formatZAR(Number(quote.total))} is ready. View it here: ${window.location.origin}/quote/${quote.public_token}`}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuotesList;
