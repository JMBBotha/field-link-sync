import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerSearchResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  is_company: boolean | null;
  phone: string;
  email: string | null;
  primary_address_line1: string | null;
  city: string | null;
  status: string | null;
  relevance: number;
}

export interface DuplicateMatch {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  email: string | null;
  primary_address_line1: string | null;
  match_type: string;
  match_score: number;
}

export function useCustomerSearch(searchTerm: string) {
  return useQuery<CustomerSearchResult[]>({
    queryKey: ["customer-search", searchTerm],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_customers", {
        search_term: searchTerm,
        max_results: 20,
      });
      if (error) throw error;
      return (data || []) as CustomerSearchResult[];
    },
    enabled: true,
    staleTime: 5000,
  });
}

export function useCheckDuplicates() {
  const [checking, setChecking] = useState(false);

  const checkDuplicates = useCallback(async (params: {
    phone?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
  }): Promise<DuplicateMatch[]> => {
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc("check_customer_duplicates", {
        p_phone: params.phone || null,
        p_email: params.email || null,
        p_first_name: params.firstName || null,
        p_last_name: params.lastName || null,
        p_address: params.address || null,
      });
      if (error) throw error;
      return (data || []) as DuplicateMatch[];
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkDuplicates, checking };
}
