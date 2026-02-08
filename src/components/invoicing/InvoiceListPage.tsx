import { useState, useEffect } from "react";
import { FileText, Filter, ChevronRight, Loader2, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  grand_total: number;
  status: string;
  created_at: string;
  lead_id: string;
  agent_id: string;
  due_date: string | null;
  paid_date: string | null;
  issue_date: string;
}

interface InvoiceListPageProps {
  agentId?: string;
  onSelectInvoice: (invoice: Invoice) => void;
  onCreateInvoice: () => void;
}

const statusFilters = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-muted", text: "text-muted-foreground", label: "Draft" },
    sent: { bg: "bg-blue-500", text: "text-white", label: "Sent" },
    paid: { bg: "bg-green-500", text: "text-white", label: "Paid" },
    overdue: { bg: "bg-red-500", text: "text-white", label: "Overdue" },
  };
  const c = config[status] || { bg: "bg-muted", text: "text-muted-foreground", label: status };
  return <Badge className={`${c.bg} ${c.text} text-[10px] px-2 py-0.5`}>{c.label}</Badge>;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

const InvoiceListPage = ({ agentId, onSelectInvoice, onCreateInvoice }: InvoiceListPageProps) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchInvoices();
  }, [agentId]);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching invoices:", error);
    } else {
      let results = (data as unknown as Invoice[]) || [];
      if (agentId) {
        results = results.filter(inv => inv.agent_id === agentId);
      }
      setInvoices(results);
    }
    setLoading(false);
  };

  const filteredInvoices = invoices
    .filter(inv => filter === "all" || inv.status === filter)
    .filter(inv =>
      !search ||
      inv.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoice_number.toLowerCase().includes(search.toLowerCase())
    );

  // Summary stats
  const totalOutstanding = invoices
    .filter(inv => inv.status === "sent" || inv.status === "overdue")
    .reduce((sum, inv) => sum + inv.grand_total, 0);
  const totalPaid = invoices
    .filter(inv => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.grand_total, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 max-w-lg mx-auto">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Outstanding</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Collected</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10 rounded-xl"
        />
      </div>

      {/* Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1 opacity-70">
                {invoices.filter(inv => inv.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Create Invoice Button */}
      <Button
        onClick={onCreateInvoice}
        className="w-full h-11 rounded-xl font-semibold gap-2"
        style={{ backgroundColor: '#0077B6' }}
      >
        <Plus className="h-4 w-4" />
        Create New Invoice
      </Button>

      {/* Invoice List */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
        </p>

        {filteredInvoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No invoices found</p>
          </div>
        ) : (
          filteredInvoices.map((invoice) => (
            <Card
              key={invoice.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors border-0 shadow-sm"
              onClick={() => onSelectInvoice(invoice)}
            >
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-primary">
                        {invoice.invoice_number}
                      </span>
                      {getStatusBadge(invoice.status)}
                    </div>
                    <p className="text-sm font-medium truncate">{invoice.customer_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(invoice.created_at)}
                      {invoice.due_date && ` • Due ${formatDate(invoice.due_date)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-base">
                      {formatCurrency(invoice.grand_total)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default InvoiceListPage;
