import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UnifiedClient {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  source: "customer" | "lead";
  lead_id?: string;
  lead_status?: string;
  lead_service_type?: string;
  customer_id?: string;
}

export function useUnifiedClients() {
  return useQuery<UnifiedClient[]>({
    queryKey: ["unified-clients"],
    queryFn: async () => {
      const [customersRes, leadsRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, name, phone, email, address, notes, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("leads")
          .select("id, customer_name, customer_phone, customer_address, customer_id, status, service_type, created_at, notes")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (customersRes.error) throw customersRes.error;
      if (leadsRes.error) throw leadsRes.error;

      const clients: UnifiedClient[] = [];
      const seenCustomerIds = new Set<string>();

      // Add all customers
      customersRes.data?.forEach((c) => {
        seenCustomerIds.add(c.id);
        clients.push({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          notes: c.notes,
          created_at: c.created_at,
          source: "customer",
          customer_id: c.id,
        });
      });

      // Add leads that aren't already linked to a customer
      leadsRes.data?.forEach((l) => {
        if (l.customer_id && seenCustomerIds.has(l.customer_id)) {
          // Customer already in list — enrich with lead info
          const existing = clients.find((c) => c.id === l.customer_id);
          if (existing && !existing.lead_id) {
            existing.lead_id = l.id;
            existing.lead_status = l.status;
            existing.lead_service_type = l.service_type;
          }
          return;
        }
        // Standalone lead without a customer record
        clients.push({
          id: `lead-${l.id}`,
          name: l.customer_name,
          phone: l.customer_phone,
          email: null,
          address: l.customer_address,
          notes: l.notes,
          created_at: l.created_at || new Date().toISOString(),
          source: "lead",
          lead_id: l.id,
          lead_status: l.status,
          lead_service_type: l.service_type,
        });
      });

      // Sort: most recent first
      clients.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return clients;
    },
    staleTime: 30000,
  });
}

export function useClientDetails(customerId: string | null) {
  return useQuery({
    queryKey: ["client-details", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      if (!customerId) return null;

      const [customerRes, leadsRes, quotesRes, invoicesRes, feedbackRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", customerId).single(),
        supabase.from("leads").select("id, service_type, status, created_at, completed_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20),
        supabase.from("quotes").select("id, quote_number, status, total, created_at").eq("customer_id", customerId).neq("status", "superseded").order("created_at", { ascending: false }).limit(20),
        supabase.from("invoices").select("id, invoice_number, status, grand_total, created_at, paid_date").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20),
        supabase.from("customer_feedback").select("rating, comment, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(10),
      ]);

      const totalRevenue = invoicesRes.data
        ?.filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + Number(i.grand_total), 0) || 0;

      const avgRating = feedbackRes.data?.length
        ? feedbackRes.data.reduce((sum, f) => sum + f.rating, 0) / feedbackRes.data.length
        : null;

      return {
        customer: customerRes.data,
        leads: leadsRes.data || [],
        quotes: quotesRes.data || [],
        invoices: invoicesRes.data || [],
        feedback: feedbackRes.data || [],
        totalRevenue,
        avgRating,
      };
    },
  });
}
