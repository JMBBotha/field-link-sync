/**
 * useQuoteVersions — frontend wiring for the quote versioning RPCs:
 *   create_quote_version(p_quote_id)
 *   accept_quote(p_quote_id, p_version_id)
 *   create_change_order(p_quote_id)
 *
 * All three are SECURITY DEFINER and company-scoped server-side; the UI only
 * needs to invalidate the shared quote keys after each call.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { quoteKeys } from "@/hooks/useQuote";

export interface QuoteVersion {
  id: string;
  quote_id: string;
  version_number: number;
  total_ex_vat: number | null;
  total_incl_vat: number | null;
  notes: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface ChangeOrderRow {
  id: string;
  quote_id: string;
  status: string;
  reason: string | null;
  total_impact_incl_vat: number | null;
  created_at: string;
}

export const quoteVersionKeys = {
  versions: (quoteId: string | null | undefined) => ["quote-versions", quoteId] as const,
  changeOrders: (quoteId: string | null | undefined) => ["quote-change-orders", quoteId] as const,
};

export async function createQuoteVersionSnapshot(quoteId: string | null | undefined): Promise<string> {
  if (!quoteId) throw new Error("A quote must be open before creating a version.");

  const { count, error: countError } = await supabase
    .from("quote_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);

  if (countError) throw countError;
  if (!count) {
    throw new Error("Add at least one line item before creating a quote version.");
  }

  const { data, error } = await supabase.rpc("create_quote_version", { p_quote_id: quoteId });
  if (error) throw error;
  if (!data) throw new Error("The quote version was not created.");
  return data as string;
}

export function useQuoteVersions(quoteId: string | null | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: quoteVersionKeys.versions(quoteId) });
    qc.invalidateQueries({ queryKey: quoteVersionKeys.changeOrders(quoteId) });
    qc.invalidateQueries({ queryKey: quoteKeys.single(quoteId) });
    qc.invalidateQueries({ queryKey: quoteKeys.lists() });
    qc.invalidateQueries({ queryKey: ["quote-document", quoteId] });
    qc.invalidateQueries({ queryKey: ["quote-document-items", quoteId] });
    qc.invalidateQueries({ queryKey: ["quotes"] });
  };

  const versions = useQuery({
    queryKey: quoteVersionKeys.versions(quoteId),
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_versions")
        .select("id, quote_id, version_number, total_ex_vat, total_incl_vat, notes, valid_until, created_at")
        .eq("quote_id", quoteId as string)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteVersion[];
    },
  });

  const changeOrders = useQuery({
    queryKey: quoteVersionKeys.changeOrders(quoteId),
    enabled: !!quoteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_orders")
        .select("id, quote_id, status, reason, total_impact_incl_vat, created_at")
        .eq("quote_id", quoteId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChangeOrderRow[];
    },
  });

  const createVersion = useMutation({
    mutationFn: () => createQuoteVersionSnapshot(quoteId),
    onSuccess: () => {
      invalidate();
      toast({ title: "New version created", description: "The quote was snapshotted as a new version." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not create version", description: e.message, variant: "destructive" }),
  });

  const acceptQuote = useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase.rpc("accept_quote", {
        p_quote_id: quoteId as string,
        p_version_id: versionId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Quote accepted", description: "This version is locked — further changes need a change order." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not accept quote", description: e.message, variant: "destructive" }),
  });

  const createChangeOrder = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_change_order", { p_quote_id: quoteId as string });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Change order raised", description: "A draft change order was created for the accepted quote." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not raise change order", description: e.message, variant: "destructive" }),
  });

  return { versions, changeOrders, createVersion, acceptQuote, createChangeOrder };
}
