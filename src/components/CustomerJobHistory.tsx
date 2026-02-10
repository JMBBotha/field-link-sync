import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, History, FileText } from "lucide-react";
import { format } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CustomerJobHistoryProps {
  customerId?: string | null;
  customerPhone?: string;
  currentLeadId?: string;
}

const CustomerJobHistory = ({ customerId, customerPhone, currentLeadId }: CustomerJobHistoryProps) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["customer-job-history", customerId, customerPhone],
    enabled: open && !!(customerId || customerPhone),
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("id, service_type, status, created_at, completed_at, scheduled_date, assigned_agent_id, customer_name")
        .order("created_at", { ascending: false })
        .limit(20);

      if (customerId) {
        query = query.eq("customer_id", customerId);
      } else if (customerPhone) {
        query = query.eq("customer_phone", customerPhone);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch invoices for these jobs
  const jobIds = jobs.map((j) => j.id);
  const { data: invoices = [] } = useQuery({
    queryKey: ["job-invoices", jobIds],
    enabled: open && jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, lead_id, status, grand_total")
        .in("lead_id", jobIds);
      if (error) throw error;
      return data || [];
    },
  });

  const invoiceMap = new Map(invoices.map((inv) => [inv.lead_id, inv]));
  const filteredJobs = jobs.filter((j) => j.id !== currentLeadId);

  if (!customerId && !customerPhone) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-1">
        <History className="h-3.5 w-3.5" />
        <span className="font-medium">Job History</span>
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">
          {open ? filteredJobs.length : "..."}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Loading...</p>
          ) : filteredJobs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No other jobs found</p>
          ) : (
            filteredJobs.map((job) => {
              const inv = invoiceMap.get(job.id);
              return (
                <div key={job.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5 bg-muted/30 dark:bg-[#0a1628]/50 dark:border-blue-400/15">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate">{job.service_type}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{job.status}</Badge>
                    </div>
                    <span className="text-muted-foreground">
                      {job.created_at ? format(new Date(job.created_at), "d MMM yyyy") : "—"}
                    </span>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {inv ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/admin/invoices`);
                        }}
                        className="flex items-center gap-1 text-primary hover:underline font-medium"
                      >
                        <FileText className="h-3 w-3" />
                        {inv.invoice_number}
                      </button>
                    ) : job.status === "completed" ? (
                      <span className="text-muted-foreground italic">Not Invoiced</span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default CustomerJobHistory;
