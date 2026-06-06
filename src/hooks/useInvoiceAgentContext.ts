import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { differenceInDays } from "date-fns";

export interface InvoiceAgentContext {
  client: {
    name: string;
    phone: string;
    email: string | null;
    address: string;
  };
  invoice: {
    id: string;
    number: string;
    amount: number;
    status: string;
    due_date: string | null;
    days_overdue: number;
  } | null;
  lead: {
    id: string;
    service_type: string;
    completion_date: string | null;
    notes: string | null;
    assigned_agent_name: string | null;
  };
  company: {
    name: string;
    phone: string;
    email: string;
    banking_details: Record<string, string> | null;
  };
  suggested_action: "payment_reminder" | "invoice_followup" | "thank_you";
  script_hints: string[];
  last_contact: string | null;
}

export const useInvoiceAgentContext = (leadId: string | null) => {
  return useQuery<InvoiceAgentContext | null>({
    queryKey: ["invoice-agent-context", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      if (!leadId) return null;

      // Fetch lead
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();
      if (leadErr || !lead) throw leadErr || new Error("Lead not found");

      // Fetch invoice, agent profile, company settings, last contact in parallel
      const [invoiceRes, agentRes, companyRes, contactRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("id, invoice_number, grand_total, status, due_date")
          .eq("lead_id", leadId)
          .limit(1)
          .maybeSingle(),
        lead.assigned_agent_id
          ? supabase.from("profiles").select("full_name").eq("id", lead.assigned_agent_id).single()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("company_settings").select("*").limit(1).maybeSingle(),
        supabase
          .from("communication_log")
          .select("created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (agentRes.error) throw agentRes.error;
      if (companyRes.error) throw companyRes.error;

      const inv = invoiceRes.data;
      const daysOverdue =
        inv?.due_date && inv.status !== "paid"
          ? Math.max(0, differenceInDays(new Date(), new Date(inv.due_date)))
          : 0;

      let suggested_action: InvoiceAgentContext["suggested_action"] = "invoice_followup";
      const script_hints: string[] = [];

      if (!inv) {
        suggested_action = "invoice_followup";
        script_hints.push("Follow up on completed job, confirm if invoice is needed");
        script_hints.push("Verify scope of work and any additional charges");
      } else if (inv.status === "paid") {
        suggested_action = "thank_you";
        script_hints.push("Thank the customer for their prompt payment");
        script_hints.push("Ask about satisfaction and any future service needs");
      } else {
        suggested_action = "payment_reminder";
        script_hints.push(`Mention Invoice #${inv.invoice_number}`);
        script_hints.push(`Outstanding amount: R ${Number(inv.grand_total).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`);
        if (daysOverdue > 30) {
          script_hints.push("Offer a payment plan if overdue by more than 30 days");
        }
        if (daysOverdue > 0) {
          script_hints.push(`Invoice is ${daysOverdue} days overdue`);
        }
      }

      const cs = companyRes.data;

      return {
        client: {
          name: lead.customer_name,
          phone: lead.customer_phone,
          email: null, // leads table doesn't store email directly
          address: lead.customer_address,
        },
        invoice: inv
          ? {
              id: inv.id,
              number: inv.invoice_number,
              amount: Number(inv.grand_total),
              status: inv.status,
              due_date: inv.due_date,
              days_overdue: daysOverdue,
            }
          : null,
        lead: {
          id: lead.id,
          service_type: lead.service_type,
          completion_date: lead.completed_at,
          notes: lead.notes,
          assigned_agent_name: agentRes.data?.full_name ?? null,
        },
        company: {
          name: cs?.company_name || "",
          phone: cs?.physical_address || "", // no phone col, use address as fallback
          email: "",
          banking_details: (cs?.banking_details as Record<string, string>) ?? null,
        },
        suggested_action,
        script_hints,
        last_contact: contactRes.data?.created_at ?? null,
      } satisfies InvoiceAgentContext;
    },
  });
};
