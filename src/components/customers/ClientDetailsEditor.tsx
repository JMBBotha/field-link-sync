import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useEntityEditor } from "@/hooks/useEntityEditor";
import ClientDetailsSections from "@/components/customers/ClientDetailsSections";
import {
  applyLocationWrite,
  companyEntityPatch,
  companyNamePatch,
  formatStoredAddress,
  initialHomeAddress,
  initialWorkFields,
  workBillingPatch,
  type LocationRef,
  type WorkAddressFields,
} from "@/lib/clientAddresses";

/**
 * Saves private fields, company name and VAT on their own.
 * Home/Work update customer_locations. Work also writes the billing address.
 */
const ClientDetailsEditor = ({
  customerId,
  companyId,
  initialData,
  locations,
}: {
  customerId: string;
  companyId: string | null;
  initialData: Record<string, any>;
  locations: LocationRef[];
}) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, savingField, update, updateField } = useEntityEditor("client", customerId, { initialData });
  const row = data ?? initialData;
  const [savingHome, setSavingHome] = useState(false);
  const [savingWork, setSavingWork] = useState(false);

  const refreshLocations = () => qc.invalidateQueries({ queryKey: ["customer-locations", customerId] });

  const writeLocation = async (kind: "Home" | "Work", address: string) => {
    if (!companyId) return false;
    await applyLocationWrite(
      {
        update: async (id, patch) => {
          const { error } = await supabase.from("customer_locations").update(patch).eq("id", id);
          if (error) throw error;
        },
        insert: async (loc) => {
          const { error } = await supabase.from("customer_locations").insert(loc);
          if (error) throw error;
        },
      },
      { customerId, companyId, kind, address, locations },
    );
    refreshLocations();
    return true;
  };

  const saveCompanyName = async (value: string | null) => {
    const named = companyNamePatch(value);
    await update(companyEntityPatch(value));
    const { error } = await supabase.from("customers").update({ is_company: named.is_company }).eq("id", customerId);
    qc.invalidateQueries({ queryKey: ["customer-detail", customerId] });
    if (error) {
      toast({
        title: "Company name saved",
        description: "The header could not switch between the person and the company.",
        variant: "destructive",
      });
    }
  };

  const saveHome = async (address: string) => {
    setSavingHome(true);
    try {
      const wrote = await writeLocation("Home", address);
      if (!wrote) {
        toast({ title: "Could not save home address", description: "This client has no company reference.", variant: "destructive" });
        return;
      }
      toast({ title: "Home address saved" });
    } catch (e: any) {
      toast({ title: "Could not save home address", description: e?.message, variant: "destructive" });
    } finally {
      setSavingHome(false);
    }
  };

  const saveWork = async (work: WorkAddressFields) => {
    setSavingWork(true);
    try {
      await update(workBillingPatch(work));
      const wrote = await writeLocation("Work", formatStoredAddress(work));
      toast({
        title: "Work address saved",
        description: wrote
          ? "Invoices bill to this address."
          : "Billing address saved. The work location could not be stored (no company reference).",
      });
    } catch (e: any) {
      toast({ title: "Could not save work address", description: e?.message, variant: "destructive" });
    } finally {
      setSavingWork(false);
    }
  };

  return (
    <ClientDetailsSections
      values={{
        name: row.name ?? null,
        phone: row.phone ?? null,
        secondary_phone: row.secondary_phone ?? null,
        email: row.email ?? null,
        company_name: row.company_name ?? null,
        vat_number: row.vat_number ?? null,
        status: row.status ?? null,
        notes: row.notes ?? null,
      }}
      homeAddress={initialHomeAddress(locations)}
      work={initialWorkFields(row, locations)}
      savingField={savingField}
      savingHome={savingHome}
      savingWork={savingWork}
      onSavePrivate={(key, value) => updateField(key, value)}
      onSaveCompanyName={saveCompanyName}
      onSaveVat={(value) => updateField("vat_number", value)}
      onSaveStatus={(value) => updateField("status", value)}
      onSaveNotes={(value) => updateField("notes", value)}
      onSaveHome={saveHome}
      onSaveWork={saveWork}
    />
  );
};

export default ClientDetailsEditor;
