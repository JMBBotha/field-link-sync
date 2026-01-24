import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, FileText, Download, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import logo from "@/assets/logo.png";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_address: string | null;
  line_items: LineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  payment_method: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

const CustomerInvoiceView = () => {
  const { token, invoiceId } = useParams<{ token: string; invoiceId?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      validateAndFetchInvoices();
    }
  }, [token, invoiceId]);

  const validateAndFetchInvoices = async () => {
    try {
      setLoading(true);

      // Validate token
      const { data: custId, error: tokenError } = await supabase.rpc(
        "validate_customer_token",
        { p_token: token }
      );

      if (tokenError || !custId) {
        setError("Invalid or expired link.");
        return;
      }

      setCustomerId(custId);

      // Get customer's leads
      const { data: leads } = await supabase
        .from("leads")
        .select("id")
        .eq("customer_id", custId);

      const leadIds = leads?.map((l) => l.id) || [];

      if (leadIds.length === 0) {
        setInvoices([]);
        return;
      }

      // Fetch invoices for customer's leads
      const { data: invoicesData, error: invError } = await supabase
        .from("invoices")
        .select("*")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false });

      if (invError) throw invError;

      // Parse line_items for each invoice
      const parsedInvoices = (invoicesData || []).map((inv) => ({
        ...inv,
        line_items: Array.isArray(inv.line_items)
          ? inv.line_items
          : typeof inv.line_items === "string"
          ? JSON.parse(inv.line_items)
          : [],
      })) as Invoice[];

      setInvoices(parsedInvoices);

      // If specific invoice requested, select it
      if (invoiceId) {
        const found = parsedInvoices.find((i) => i.id === invoiceId);
        setSelectedInvoice(found || null);
      }

    } catch (err) {
      console.error("Error:", err);
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Invoice Detail View
  if (selectedInvoice) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        {/* Header */}
        <header className="bg-[#0077B6] text-white p-4 shadow-md print:hidden">
          <div className="max-w-2xl mx-auto flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => setSelectedInvoice(null)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <img src={logo} alt="Be Cool" className="h-10" />
            <h1 className="font-bold">Invoice {selectedInvoice.invoice_number}</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto p-4">
          <Card className="print:shadow-none print:border-none">
            {/* Invoice Header */}
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <img src={logo} alt="Be Cool" className="h-12 mb-2 hidden print:block" />
                <CardTitle>{selectedInvoice.invoice_number}</CardTitle>
                <CardDescription>
                  {format(new Date(selectedInvoice.created_at), "dd MMMM yyyy")}
                </CardDescription>
              </div>
              <Badge
                className={
                  selectedInvoice.status === "paid"
                    ? "bg-green-500"
                    : selectedInvoice.status === "sent"
                    ? "bg-blue-500"
                    : "bg-gray-500"
                }
              >
                {selectedInvoice.status === "paid" && <CheckCircle className="h-3 w-3 mr-1" />}
                {selectedInvoice.status.toUpperCase()}
              </Badge>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Customer Info */}
              <div>
                <p className="text-sm text-muted-foreground">Bill To:</p>
                <p className="font-medium">{selectedInvoice.customer_name}</p>
                {selectedInvoice.customer_address && (
                  <p className="text-sm text-muted-foreground">{selectedInvoice.customer_address}</p>
                )}
              </div>

              {/* Line Items */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3">Description</th>
                      <th className="text-center p-3 w-16">Qty</th>
                      <th className="text-right p-3 w-24">Price</th>
                      <th className="text-right p-3 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.line_items.map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-3">{item.description}</td>
                        <td className="p-3 text-center">{item.quantity}</td>
                        <td className="p-3 text-right">R {Number(item.unitPrice).toFixed(2)}</td>
                        <td className="p-3 text-right">R {Number(item.total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="space-y-2 text-right">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span>R {Number(selectedInvoice.subtotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT ({selectedInvoice.tax_rate}%):</span>
                  <span>R {Number(selectedInvoice.tax_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Total Due:</span>
                  <span>R {Number(selectedInvoice.grand_total).toFixed(2)}</span>
                </div>
              </div>

              {/* Notes */}
              {selectedInvoice.notes && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{selectedInvoice.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 print:hidden">
                <Button onClick={handlePrint} variant="outline" className="flex-1">
                  <Download className="h-4 w-4 mr-2" />
                  Download / Print
                </Button>
                {selectedInvoice.status !== "paid" && (
                  <Button className="flex-1 bg-green-600 hover:bg-green-700">
                    Pay Now
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Invoice List View
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-[#0077B6] text-white p-4 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => navigate(`/customer/${token}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logo} alt="Be Cool" className="h-10" />
          <h1 className="font-bold">Your Invoices</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {invoices.length === 0 ? (
          <Card className="text-center py-8">
            <CardContent>
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No invoices yet</p>
            </CardContent>
          </Card>
        ) : (
          invoices.map((invoice) => (
            <Card
              key={invoice.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedInvoice(invoice)}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">{invoice.invoice_number}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(invoice.created_at), "dd MMM yyyy")}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">R {Number(invoice.grand_total).toFixed(2)}</p>
                  <Badge
                    className={
                      invoice.status === "paid"
                        ? "bg-green-500"
                        : invoice.status === "sent"
                        ? "bg-blue-500"
                        : "bg-gray-500"
                    }
                  >
                    {invoice.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
};

export default CustomerInvoiceView;
