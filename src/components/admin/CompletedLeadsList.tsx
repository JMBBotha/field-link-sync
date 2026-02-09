import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import LeadDetailSheet from "@/components/LeadDetailSheet";

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

      // Fetch all invoices linked to leads
      const leadIds = completedLeads.map((l) => l.id);
      const { data: invoices, error: invError } = await supabase
        .from("invoices")
        .select("id, lead_id, status, grand_total")
        .in("lead_id", leadIds);

      if (invError) throw invError;

      const invoiceMap = new Map(
        (invoices || []).map((inv) => [inv.lead_id, inv])
      );

      return completedLeads.map((lead) => {
        const inv = invoiceMap.get(lead.id);
        return {
          ...lead,
          invoice_id: inv?.id ?? null,
          invoice_status: inv?.status ?? null,
          invoice_total: inv ? Number(inv.grand_total) : null,
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

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Completed Leads</CardTitle>
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
                    "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant={lead.invoice_id ? "default" : "destructive"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {lead.invoice_id ? "Invoiced" : "Not Invoiced"}
                      </Badge>
                      {lead.invoice_id && (
                        <>
                          <Badge
                            className={cn(
                              "text-[10px] px-1.5 py-0 border-0",
                              lead.invoice_status === "paid"
                                ? "bg-emerald-500/15 text-emerald-600"
                                : "bg-orange-500/15 text-orange-600"
                            )}
                          >
                            {lead.invoice_status === "paid" ? "Paid" : "Unpaid"}
                          </Badge>
                          <span className="text-xs font-medium">
                            R {(lead.invoice_total ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                          </span>
                        </>
                      )}
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
    </>
  );
};

export default CompletedLeadsList;
