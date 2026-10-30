import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sb, DOC_SELECT } from "@/components/supplierDocs/api";
import SupplierDocCard from "@/components/supplierDocs/SupplierDocCard";
import AddSupplierDocDialog from "@/components/supplierDocs/AddSupplierDocDialog";
import BotLoginCard from "@/components/supplierDocs/BotLoginCard";

/** Office-only list: "Needs linking" inbox + warranty search by model, serial, supplier, doc/PO number or client. */
export default function AdminSupplierDocsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"needs" | "all">("needs");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data: companyId } = useQuery({
    queryKey: ["my-company-id", user?.id], enabled: !!user?.id,
    queryFn: async () => (await sb.rpc("caller_company_id")).data as string | null,
  });
  const { data: docs = [], refetch, isLoading } = useQuery({
    queryKey: ["supplier-docs-page", tab, q], enabled: !!companyId,
    queryFn: async () => {
      const { data: hits, error } = await sb.rpc("sjd_search", { p_q: q, p_limit: 100 });
      if (error) throw error;
      let ids = (hits ?? []).filter((h: any) => tab === "all" || h.needs_linking).map((h: any) => h.document_id);
      if (tab === "needs") {
        const { data: sug } = await sb.from("supplier_job_document_links").select("document_id").eq("status", "suggested");
        const sugIds = new Set((sug ?? []).map((s: any) => s.document_id));
        ids = (hits ?? []).filter((h: any) => h.needs_linking || sugIds.has(h.document_id)).map((h: any) => h.document_id);
      }
      if (!ids.length) return [];
      const { data } = await sb.from("supplier_job_documents").select(DOC_SELECT).in("id", ids).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Lock className="h-5 w-5" /> Supplier documents</h1>
        {companyId && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Delivery notes, supplier invoices and POs. Private to admin and dispatch.</p>
      <BotLoginCard />
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "needs" ? "default" : "outline"} onClick={() => setTab("needs")} data-testid="sjd-tab-needs">Needs linking</Button>
        <Button size="sm" variant={tab === "all" ? "default" : "outline"} onClick={() => setTab("all")}>All</Button>
      </div>
      <Input placeholder="Search model, serial, supplier, doc or PO number, client" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sjd-search" />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : docs.length ? <div className="space-y-2">{docs.map((d: any) => <SupplierDocCard key={d.id} doc={d} onChanged={() => refetch()} />)}</div>
        : <p className="text-sm text-muted-foreground">{tab === "needs" ? "Nothing waiting to be linked." : "No documents found."}</p>}
      {companyId && <AddSupplierDocDialog open={open} onOpenChange={setOpen} companyId={companyId} onSaved={() => refetch()} />}
    </div>
  );
}
