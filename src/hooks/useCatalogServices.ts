import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { orderServicesForPicker, toServiceRow, type CatalogService } from "@/lib/catalogServices";

/** The ONLY service list: catalog_services, core first, then this company's custom rows. */
export function useCatalogServices(companyId: string | null) {
  const q = useQuery({
    queryKey: ["catalog-services", companyId],
    staleTime: 60_000,
    queryFn: async () => {
      const [svc, master] = await Promise.all([
        (supabase.from("catalog_services") as any)
          .select("id, name, description, sort_order, origin, owner_company_id, is_active, search_aliases")
          .eq("is_active", true),
        (supabase.from("companies") as any).select("name").eq("is_master", true).maybeSingle(),
      ]);
      if (svc.error) throw svc.error;
      return { rows: (svc.data || []) as CatalogService[], masterName: (master.data?.name as string) || "the main company" };
    },
  });
  const ordered = orderServicesForPicker(q.data?.rows ?? [], companyId);
  return { services: ordered, serviceRows: ordered.map(toServiceRow), masterName: q.data?.masterName ?? "the main company", refetch: q.refetch };
}
