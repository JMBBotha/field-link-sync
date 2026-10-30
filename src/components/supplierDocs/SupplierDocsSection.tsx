import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, FileText } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { sb, openDocFile, docTypeLabel } from "./api";
import { toast } from "sonner";

type Line = { line_no: number; model: string | null; serial: string | null; qty: number; description: string | null };
type ClientDoc = { id: string; supplier: string | null; doc_type: string; doc_number: string | null; po_number: string | null; doc_date: string | null; storage_path: string | null; notes: string[] | null; whole: boolean; shared_with: number; lines: Line[] };

/** Client page only: office-only, read-only list of supplier documents linked to this client. */
export default function SupplierDocsSection({ companyId, customerId }: { companyId?: string | null; customerId: string }) {
  const { isAdmin, isDispatcher } = useRole();
  const { isSalesRep } = useSalesRep();
  const allowed = (isAdmin || isDispatcher) && !isSalesRep && !!companyId;
  const { data: docs = [] } = useQuery({
    queryKey: ["sjd-client-docs", customerId],
    enabled: allowed,
    queryFn: async () => ((await sb.rpc("sjd_client_docs", { p_customer_id: customerId })).data ?? []) as ClientDoc[],
  });
  if (!allowed) return null;
  return (
    <Card className="rounded-2xl" data-testid="supplier-docs-section">
      <CardContent className="p-3 md:p-4 space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Lock className="h-4 w-4 text-muted-foreground" /> Supplier documents <span className="text-xs font-normal text-muted-foreground">(office only)</span></h3>
        {docs.length ? docs.map((d) => <DocRow key={d.id} d={d} />) : <p className="text-xs text-muted-foreground">No supplier documents for this client yet.</p>}
      </CardContent>
    </Card>
  );
}

function DocRow({ d }: { d: ClientDoc }) {
  const [showNote, setShowNote] = useState(false);
  const notes = (d.notes ?? []).filter(Boolean);
  return (
    <div className="rounded-xl border p-2.5 space-y-1.5" data-testid="sjd-client-doc">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{d.supplier ?? "Supplier"}</div>
          <div className="text-xs text-muted-foreground">{docTypeLabel(d.doc_type)} {d.doc_number ?? ""}{d.doc_date ? ` · ${d.doc_date}` : ""}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {notes.length > 0 && <button type="button" onClick={() => setShowNote((v) => !v)} className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium" data-testid="sjd-check">check</button>}
          {d.storage_path && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openDocFile(d.storage_path).catch((e) => toast.error(e.message))}><FileText className="h-3.5 w-3.5 mr-1" />Open</Button>}
        </div>
      </div>
      {showNote && <p className="text-xs rounded-lg bg-orange-50 text-orange-800 p-2">{notes.join(" · ")}</p>}
      {d.lines?.length > 0 && <ul className="text-xs space-y-0.5">
        {d.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.model ?? l.description ?? `Line ${l.line_no}`}{l.serial ? <span className="text-muted-foreground"> · S/N {l.serial}</span> : null}</span><span className="text-muted-foreground">×{l.qty}</span></li>)}
      </ul>}
      {d.shared_with > 0 && <p className="text-[11px] text-muted-foreground">Shared with {d.shared_with} other client{d.shared_with > 1 ? "s" : ""}</p>}
    </div>
  );
}
