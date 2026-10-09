import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

/** "One Stop Shop extras" link on the price lists page — master-catalogue admins only (DB function decides). */
export default function OssExtrasLink() {
  const navigate = useNavigate();
  const { data: canWrite = false } = useQuery({
    queryKey: ["oss-extras-can-write"],
    staleTime: 300_000,
    retry: false,
    queryFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s?.session?.user?.id;
      if (!uid || typeof (supabase as any).rpc !== "function") return false;
      const { data, error } = await (supabase.rpc as any)("can_write_master_catalog", { _uid: uid });
      return !error && !!data;
    },
  });
  if (!canWrite) return null;
  return (
    <div className="flex shrink-0 justify-end px-2 pt-1">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/admin/oss-extras")} data-testid="oss-extras-link">
        <Plus className="mr-1 h-3.5 w-3.5" />One Stop Shop extras
      </Button>
    </div>
  );
}
