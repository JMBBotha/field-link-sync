import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sb, DOC_SELECT } from "@/components/supplierDocs/api";
import SupplierDocCard from "@/components/supplierDocs/SupplierDocCard";
import AddSupplierDocDialog from "@/components/supplierDocs/AddSupplierDocDialog";
import BotLoginCard from "@/components/supplierDocs/BotLoginCard";
import ReceiveSupplierDocDialog, { type PendingDoc } from "@/components/stock/ReceiveSupplierDocDialog";
import { PackagePlus } from "lucide-react";

/** Office-only list: warranty search by model, serial, supplier, doc/PO number or client. */
export default function AdminSupplierDocsPage() {
  const { user } = useAuth();
  const tab = "all";
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const docId = params.get("doc");
  // ?doc=<id> deep link: show that document first, highlighted.
  const { data: focusDoc, refetch: refetchFocus } = useQuery({
    queryKey: ["supplier-doc-focus", docId], enabled: !!docId,
    queryFn: async () => { const { data } = await sb.from("supplier_job_documents").select(DOC_SELECT).eq("id", docId!).maybeSingle(); return data ?? null; },
  });
  useEffect(() => { if (focusDoc) setTimeout(() => document.getElementById(`sjd-${focusDoc.id}`)?.scrollIntoView({ block: "center" }), 100); }, [focusDoc]);
  const [open, setOpen] = useState(false);
  const [recv, setRecv] = useState(false);
  const [pending, setPending] = useState<PendingDoc | null>(null);
  const { data: companyId } = useQuery({
    queryKey: ["my-company-id", user?.id], enabled: !!user?.id,
    queryFn: async () => (await sb.rpc("caller_company_id")).data as string | null,
  });
  // Receiving stock is admin only; dispatch can still view documents. Missing RPC (migration not applied) = hidden.
  const { data: canReceive = false } = useQuery({
    queryKey: ["cf-can-receive", companyId], enabled: !!companyId,
    queryFn: async () => { const { data, error } = await sb.rpc("cf_can_receive", { p_company: companyId }); return !error && data === true; },
  });
  const { data: docs = [], refetch, isLoading } = useQuery({
    queryKey: ["supplier-docs-page", tab, q], enabled: !!companyId,
    queryFn: async () => {
      const { data: hits, error } = await sb.rpc("sjd_search", { p_q: q, p_limit: 100 });
      if (error) throw error;
      const ids = (hits ?? []).map((h: any) => h.document_id);
      if (!ids.length) return [];
      const { data } = await sb.from("supplier_job_documents").select(DOC_SELECT).in("id", ids).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Lock className="h-5 w-5" /> Supplier documents</h1>
        <div className="flex gap-2">
          {companyId && canReceive && <Button size="sm" variant="outline" onClick={() => { setPending(null); setRecv(true); }} data-testid="receive-stock"><PackagePlus className="h-4 w-4 mr-1" />Receive stock</Button>}
          {companyId && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Delivery notes, supplier invoices and POs. Private to admin and dispatch.</p>
      <BotLoginCard />
      <Input placeholder="Search model, serial, supplier, doc or PO number, client" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sjd-search" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : (docs.length || focusDoc) ? <div className="space-y-2">
            {focusDoc && <div id={`sjd-${focusDoc.id}`} data-testid="sjd-focus" className="rounded-xl ring-2 ring-[#1590D6]"><SupplierDocCard doc={focusDoc} canReceive={canReceive} onConfirm={(p) => { setPending(p); setRecv(true); }} onChanged={() => { refetch(); refetchFocus(); }} />
              <button type="button" className="px-3 pb-2 text-xs text-muted-foreground hover:underline" onClick={() => { const n = new URLSearchParams(params); n.delete("doc"); setParams(n, { replace: true }); }}>Show all documents</button></div>}
            {docs.filter((d: any) => d.id !== focusDoc?.id).map((d: any) => <div key={d.id} id={`sjd-${d.id}`}><SupplierDocCard doc={d} canReceive={canReceive} onConfirm={(p) => { setPending(p); setRecv(true); }} onChanged={() => refetch()} /></div>)}</div>
        : <p className="text-sm text-muted-foreground">No documents found.</p>}
      {companyId && <AddSupplierDocDialog open={open} onOpenChange={setOpen} companyId={companyId} onSaved={() => refetch()} />}
      {companyId && canReceive && <ReceiveSupplierDocDialog key={pending?.id ?? "upload"} open={recv} onOpenChange={(o) => { setRecv(o); if (!o) setPending(null); }} companyId={companyId} pending={pending} onSaved={() => refetch()} />}
    </div>
  );
}
