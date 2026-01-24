import { useState, useEffect } from "react";
import { FileText, Filter, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
}

interface InvoiceListProps {
  agentId?: string;
  onSelectInvoice: (invoice: Invoice) => void;
}

const statusFilters = [
  { value: "all", label: "All Invoices" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-gray-500", text: "text-white", label: "Draft" },
    sent: { bg: "bg-blue-500", text: "text-white", label: "Sent" },
    paid: { bg: "bg-green-500", text: "text-white", label: "Paid" },
    overdue: { bg: "bg-red-500", text: "text-white", label: "Overdue" },
  };
  const c = config[status] || { bg: "bg-gray-500", text: "text-white", label: status };
  return (
    <Badge className={`${c.bg} ${c.text} text-xs`}>
      {c.label}
    </Badge>
  );
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const InvoiceList = ({ agentId, onSelectInvoice }: InvoiceListProps) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchInvoices();
  }, [agentId]);

  const fetchInvoices = async () => {
    setLoading(true);
    
    const { data, error } = await supabase
      .from("invoices" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (agentId && data) {
      setInvoices((data as unknown as Invoice[]).filter(inv => inv.agent_id === agentId) || []);
    } else if (error) {
      console.error("Error fetching invoices:", error);
    } else {
      setInvoices((data as unknown as Invoice[]) || []);
    }
    setLoading(false);
  };

  const filteredInvoices = filter === "all" 
    ? invoices 
    : invoices.filter(inv => inv.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#0077B6]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusFilters.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">
          {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Invoice List */}
      {filteredInvoices.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No invoices found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredInvoices.map((invoice) => (
            <Card
              key={invoice.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => onSelectInvoice(invoice)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm" style={{ color: '#0077B6' }}>
                        {invoice.invoice_number}
                      </span>
                      {getStatusBadge(invoice.status)}
                    </div>
                    <p className="text-sm font-medium">{invoice.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(invoice.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-lg">
                      {formatCurrency(invoice.grand_total)}
                    </span>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
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

export default InvoiceList;