import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, RefreshCw, FilePlus, Download, FileText } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import LeadDetailSheet from "@/components/LeadDetailSheet";
import LeadActionButtons from "./LeadActionButtons";
import CreateInvoiceDialog from "@/components/invoicing/CreateInvoiceDialog";
import { exportToCSV } from "@/lib/csvExport";
import jsPDF from "jspdf";

type FilterTab = "all" | "invoiced" | "not_invoiced" | "paid" | "unpaid";

interface CompletedLeadWithInvoice {
  id: string;
  customer_name: string;
  service_type: string;
  completed_at: string | null;
  customer_phone: string;
  customer_address: string;
  latitude: number;
  longitude: number;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
  scheduled_date?: string | null;
  invoice_id: string | null;
  invoice_status: string | null;
  invoice_total: number | null;
  invoice_number: string | null;
  customer_email: string | null;
}

const filterTabs: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "invoiced", label: "Invoiced" },
  { value: "not_invoiced", label: "Not Invoiced" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
];

const CompletedLeadsList = () => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [selectedLead, setSelectedLead] = useState<CompletedLeadWithInvoice | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [invoiceDialogLead, setInvoiceDialogLead] = useState<CompletedLeadWithInvoice | null>(null);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const { data: leads, isLoading, isError, refetch } = useQuery({
    queryKey: ["completed-leads-with-invoices"],
    queryFn: async () => {
      // Fetch completed leads
      const { data: completedLeads, error: leadsError } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(200);

      if (leadsError) throw leadsError;
      if (!completedLeads?.length) return [];

      // Fetch invoices and customer emails in parallel
      const leadIds = completedLeads.map((l) => l.id);
      const customerIds = completedLeads.map((l) => l.customer_id).filter(Boolean) as string[];

      const [invoiceRes, customerRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, lead_id, status, grand_total, invoice_number")
          .in("lead_id", leadIds),
        customerIds.length > 0
          ? supabase.from("customers").select("id, email").in("id", customerIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (invoiceRes.error) throw invoiceRes.error;

      const invoiceMap = new Map(
        (invoiceRes.data || []).map((inv) => [inv.lead_id, inv])
      );
      const customerEmailMap = new Map(
        (customerRes.data || []).map((c) => [c.id, c.email])
      );

      return completedLeads.map((lead) => {
        const inv = invoiceMap.get(lead.id);
        return {
          ...lead,
          invoice_id: inv?.id ?? null,
          invoice_status: inv?.status ?? null,
          invoice_total: inv ? Number(inv.grand_total) : null,
          invoice_number: inv?.invoice_number ?? null,
          customer_email: lead.customer_id ? customerEmailMap.get(lead.customer_id) ?? null : null,
        } as CompletedLeadWithInvoice;
      });
    },
    refetchInterval: 60000,
  });

  const filtered = (leads || []).filter((l) => {
    switch (activeFilter) {
      case "invoiced": return l.invoice_id !== null;
      case "not_invoiced": return l.invoice_id === null;
      case "paid": return l.invoice_status === "paid";
      case "unpaid": return l.invoice_id !== null && l.invoice_status !== "paid";
      default: return true;
    }
  });

  const stats = {
    total: leads?.length ?? 0,
    invoiced: leads?.filter((l) => l.invoice_id !== null).length ?? 0,
    notInvoiced: leads?.filter((l) => l.invoice_id === null).length ?? 0,
    paid: leads?.filter((l) => l.invoice_status === "paid").length ?? 0,
    unpaid: leads?.filter((l) => l.invoice_id !== null && l.invoice_status !== "paid").length ?? 0,
    totalValue: leads?.reduce((sum, l) => sum + (l.invoice_total ?? 0), 0) ?? 0,
  };

  // Stub handlers for LeadDetailSheet (read-only context on admin home)
  const noOp = async () => {};

  const handleCSVExport = () => {
    const rows = filtered.map(l => ({
      customer: l.customer_name,
      service: l.service_type,
      completed: l.completed_at ? format(new Date(l.completed_at), "yyyy-MM-dd HH:mm") : "",
      invoice: l.invoice_number || "N/A",
      status: l.invoice_status || "Not invoiced",
      amount: l.invoice_total ?? "",
    }));
    exportToCSV(rows, `completed-leads-${format(new Date(), "yyyy-MM-dd")}`);
  };

  const handlePDFExport = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Completed Leads Report", 14, 20);
    doc.setFontSize(9);
    doc.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}`, 14, 28);
    doc.text(`Total: ${filtered.length} leads | Invoiced Value: R ${stats.totalValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, 14, 34);

    let y = 44;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Customer", 14, y);
    doc.text("Service", 70, y);
    doc.text("Completed", 110, y);
    doc.text("Invoice", 145, y);
    doc.text("Amount", 175, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    filtered.forEach(l => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(l.customer_name?.slice(0, 30) || "", 14, y);
      doc.text(l.service_type?.slice(0, 20) || "", 70, y);
      doc.text(l.completed_at ? format(new Date(l.completed_at), "dd MMM yy") : "", 110, y);
      doc.text(l.invoice_number || "—", 145, y);
      doc.text(l.invoice_total != null ? `R ${l.invoice_total.toLocaleString()}` : "—", 175, y);
      y += 5;
    });

    doc.save(`completed-leads-${format(new Date(), "yyyy-MM-dd")}.pdf`);
  };

  return (
    <>
      <Card className="surface-card-solid">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Completed Leads</CardTitle>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCSVExport}>
                <Download className="h-3 w-3 mr-1" />CSV
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handlePDFExport}>
                <FileText className="h-3 w-3 mr-1" />PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary Bar */}
          {!isLoading && !isError && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
              {[
                { label: "Total", value: stats.total },
                { label: "Invoiced", value: stats.invoiced },
                { label: "Not Invoiced", value: stats.notInvoiced },
                { label: "Paid", value: stats.paid },
                { label: "Unpaid", value: stats.unpaid },
                {
                  label: "Invoiced Value",
                  value: `R ${stats.totalValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-bold">{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex gap-1 flex-wrap">
            {filterTabs.map((tab) => (
              <Button
                key={tab.value}
                variant={activeFilter === tab.value ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setActiveFilter(tab.value)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-8 space-y-2">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
              <p className="text-sm text-muted-foreground">Failed to load completed leads</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-3 w-3" /> Retry
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !isError && filtered.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/50 mx-auto" />
              <p className="text-sm text-muted-foreground">
                {activeFilter === "all"
                  ? "No completed leads yet. Once jobs are marked complete, they'll appear here."
                  : "No leads match this filter."}
              </p>
            </div>
          )}

          {/* List */}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
              {filtered.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => {
                    setSelectedLead(lead);
                    setSheetOpen(true);
                  }}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-colors",
                    "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "dark:bg-gradient-to-r dark:from-[#0b1a2e] dark:via-[#153258]/40 dark:to-[#0b1a2e] dark:border-[#153258]/50 dark:hover:border-[#1e4a80]/60"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{lead.customer_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{lead.service_type}</p>
                      {lead.completed_at && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(lead.completed_at), "dd MMM yyyy")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <LeadActionButtons
                        leadId={lead.id}
                        customerName={lead.customer_name}
                        customerPhone={lead.customer_phone}
                        customerEmail={lead.customer_email}
                        invoiceNumber={lead.invoice_number}
                        invoiceAmount={lead.invoice_total}
                        invoiceStatus={lead.invoice_status}
                      />
                      <div className="flex flex-col items-end gap-1">
                        {lead.invoice_id ? (
                          <>
                            <Badge
                              className={cn(
                                "text-[10px] px-1.5 py-0 border-0",
                                lead.invoice_status === "paid"
                                  ? "bg-emerald-500/15 text-emerald-600"
                                  : "bg-orange-500/15 text-orange-600"
                              )}
                            >
                              {lead.invoice_status === "paid" ? "Paid" : "Invoiced"} – {lead.invoice_number}
                            </Badge>
                            <span className="text-xs font-medium">
                              R {(lead.invoice_total ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                            </span>
                          </>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInvoiceDialogLead(lead);
                            }}
                          >
                            <FilePlus className="h-3 w-3" />
                            Create Invoice
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lead Detail Sheet */}
      <LeadDetailSheet
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setSelectedLead(null);
        }}
        onAccept={noOp}
        onStart={async () => {}}
        onComplete={noOp}
        onRelease={noOp}
        loadingAction={null}
        onLeadUpdated={() => refetch()}
      />

      {/* Invoice creation dialog */}
      {invoiceDialogLead && currentUserId && (
        <CreateInvoiceDialog
          open={!!invoiceDialogLead}
          onClose={() => {
            setInvoiceDialogLead(null);
            refetch();
          }}
          agentId={currentUserId}
          prefillLead={{
            id: invoiceDialogLead.id,
            customer_name: invoiceDialogLead.customer_name,
            customer_phone: invoiceDialogLead.customer_phone,
            customer_address: invoiceDialogLead.customer_address,
            customer_id: invoiceDialogLead.customer_id,
            service_type: invoiceDialogLead.service_type,
          }}
        />
      )}
    </>
  );
};

export default CompletedLeadsList;
