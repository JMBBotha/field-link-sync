import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, FileText, Download, Link2, FileCheck2, ChevronDown, FileSignature } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ListSkeleton } from "@/components/ui/skeletons";
import { convertQuoteToInvoice } from "@/lib/convertQuoteToInvoice";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import StatusPill from "@/components/shared/StatusPill";

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
  const [selected, setSelected] = useState<string[]>([]);
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
        .neq("status", "superseded")
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

  const statCards = [
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "accepted", label: "Accepted" },
    { key: "declined", label: "Declined" },
  ].map((s) => {
    const rows = (quotes as any[]).filter((q) => q.status === s.key);
    return {
      ...s,
      count: rows.length,
      total: rows.reduce((sum, q) => sum + Number(q.total || 0), 0),
    };
  });

  const allSelected = quotes.length > 0 && selected.length === quotes.length;
  const toggleAll = () =>
    setSelected(allSelected ? [] : (quotes as any[]).map((q) => q.id));
  const toggleOne = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="min-h-full bg-background">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Estimates
            <HelpTip title="Quotes" side="bottom">
              Once a quote is <strong>Accepted</strong>, use the green <em>Convert to Invoice</em>
              icon on the row to generate a draft invoice with the same customer, location and line items.
            </HelpTip>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotes.length} quote{quotes.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="brand" onClick={onCreateNew}>
          <Plus className="mr-2 h-4 w-4" /> New Quote
        </Button>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {/* Summary stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((s) => (
            <Card key={s.key} className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">{s.count}</p>
                <p className="text-xs text-muted-foreground">{formatZAR(s.total)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search quotes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {statuses.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className="text-xs capitalize"
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : quotes.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-10 w-10 opacity-50" />
              <p>No quotes yet. Create your first quote!</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all quotes"
                      />
                    </TableHead>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(quotes as any[]).map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer"
                      onClick={() => onEditQuote(quote.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.includes(quote.id)}
                          onCheckedChange={() => toggleOne(quote.id)}
                          aria-label={`Select quote ${quote.quote_number || ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm font-bold text-primary">
                        {quote.quote_number || (
                          <span className="text-xs text-warning">No number – draft</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="truncate text-sm text-foreground">
                          {quote.customers?.name || "No customer"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {quote.customers?.phone || ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusPill status={quote.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(quote.created_at).toLocaleDateString("en-ZA")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-bold text-foreground">
                        {formatZAR(Number(quote.total))}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
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
                              className="h-7 w-7 text-brand-green hover:text-brand-green"
                              onClick={() => handleConvertToInvoice(quote.id)}
                              disabled={converting === quote.id}
                              title="Convert to Invoice"
                            >
                              {converting === quote.id ? (
                                <Spinner size="xs" />
                              ) : (
                                <FileCheck2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                          {quote.public_token && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/quote/${quote.public_token}`,
                                  );
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default QuotesList;
