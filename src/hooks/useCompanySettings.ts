import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

export interface CompanySettings {
  id?: string;
  company_name: string;
  vat_number: string;
  physical_address: string;
  postal_address: string;
  logo_storage_path: string;
  default_hourly_rate: number;
  default_deposit_percentage: number;
  default_payment_terms_days: number;
  payfast_merchant_id: string;
  payfast_merchant_key: string;
  banking_details: {
    bank_name?: string;
    account_name?: string;
    account_number?: string;
    branch_code?: string;
    account_type?: string;
  };
}

const defaultSettings: CompanySettings = {
  company_name: "",
  vat_number: "",
  physical_address: "",
  postal_address: "",
  logo_storage_path: "",
  default_hourly_rate: 450,
  default_deposit_percentage: 50,
  default_payment_terms_days: 30,
  payfast_merchant_id: "",
  payfast_merchant_key: "",
  banking_details: {},
};

export const useCompanySettings = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["company-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        company_name: data.company_name || "",
        vat_number: data.vat_number || "",
        physical_address: data.physical_address || "",
        postal_address: data.postal_address || "",
        logo_storage_path: data.logo_storage_path || "",
        default_hourly_rate: Number(data.default_hourly_rate) || 450,
        default_deposit_percentage: Number(data.default_deposit_percentage) || 50,
        default_payment_terms_days: data.default_payment_terms_days || 30,
        payfast_merchant_id: data.payfast_merchant_id || "",
        payfast_merchant_key: data.payfast_merchant_key || "",
        banking_details: (data.banking_details as CompanySettings["banking_details"]) || {},
      } as CompanySettings;
    },
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (updated: CompanySettings) => {
      if (updated.id) {
        const { error } = await supabase
          .from("company_settings")
          .update({
            company_name: updated.company_name,
            vat_number: updated.vat_number,
            physical_address: updated.physical_address,
            postal_address: updated.postal_address,
            logo_storage_path: updated.logo_storage_path,
            default_hourly_rate: updated.default_hourly_rate,
            default_deposit_percentage: updated.default_deposit_percentage,
            default_payment_terms_days: updated.default_payment_terms_days,
            payfast_merchant_id: updated.payfast_merchant_id,
            payfast_merchant_key: updated.payfast_merchant_key,
            banking_details: updated.banking_details as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq("id", updated.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("company_settings").insert({
          company_name: updated.company_name,
          vat_number: updated.vat_number,
          physical_address: updated.physical_address,
          postal_address: updated.postal_address,
          logo_storage_path: updated.logo_storage_path,
          default_hourly_rate: updated.default_hourly_rate,
          default_deposit_percentage: updated.default_deposit_percentage,
          default_payment_terms_days: updated.default_payment_terms_days,
          payfast_merchant_id: updated.payfast_merchant_id,
          payfast_merchant_key: updated.payfast_merchant_key,
          banking_details: updated.banking_details as unknown as Json,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast({ title: "Settings saved ✅" });
    },
    onError: (err: unknown) => {
      const description = err instanceof Error ? err.message : "Failed to save settings";
      toast({ title: "Error saving settings", description, variant: "destructive" });
    },
  });

  return {
    settings: settings || defaultSettings,
    isLoading,
    needsSetup: !isLoading && !settings,
    saveSettings: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
};
