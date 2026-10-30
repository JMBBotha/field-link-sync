import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Plus } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { sb, DOC_SELECT } from "./api";
import SupplierDocCard from "./SupplierDocCard";
import AddSupplierDocDialog from "./AddSupplierDocDialog";

/** Private "Supplier documents" section for job detail (jobId) or client page (customerId). Office only. */
export default function SupplierDocsSection({ companyId, jobId, customerId }: { companyId?: string | null; jobId?: string; customerId?: string }) {
  const { isAdmin, isDispatcher } = useRole();
  const { isSalesRep } = useSalesRep();
  const allowed = (isAdmin || isDispatcher) && !isSalesRep && !!companyId;
  const [open, setOpen] = useState(false);
  const { data: docs = [], refetch } = useQuery({
    queryKey: ["supplier-docs", jobId ?? null, customerId ?? null],
    enabled: allowed,
    queryFn: async () => {
      let q = sb.from("supplier_job_document_links").select("document_id");
      q = jobId ? q.eq("job_id", jobId) : q.eq("customer_id", customerId);
      const { data: ls } = await q;
      const ids = [...new Set((ls ?? []).map((l: any) => l.document_id))];
      if (!ids.length) return [];
      const { data } = await sb.from("supplier_job_documents").select(DOC_SELECT).in("id", ids).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  if (!allowed) return null;
  return (
    <Card className="rounded-2xl" data-testid="supplier-docs-section">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm flex items-center gap-1.5"><Lock className="h-4 w-4 text-muted-foreground" /> Supplier documents <span className="text-xs font-normal text-muted-foreground">(private)</span></h3>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="sjd-add"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        {docs.length ? docs.map((d: any) => <SupplierDocCard key={d.id} doc={d} onChanged={() => refetch()} highlightJobId={jobId} />)
          : <p className="text-xs text-muted-foreground">No delivery notes or supplier invoices yet. Add one for warranty records.</p>}
        <a href="/admin/supplier-docs" className="text-xs text-primary underline">Search all supplier documents</a>
      </CardContent>
      <AddSupplierDocDialog open={open} onOpenChange={setOpen} companyId={companyId!} jobId={jobId} customerId={customerId} onSaved={() => refetch()} />
    </Card>
  );
}
