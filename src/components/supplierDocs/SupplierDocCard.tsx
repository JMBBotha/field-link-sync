import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileText, X, Link2 } from "lucide-react";
import { docTypeLabel, openDocFile, linkDoc, unlinkDoc, attachDocFile, sb } from "./api";
import type { PendingDoc } from "@/components/stock/ReceiveSupplierDocDialog";
import JobPicker from "./JobPicker";
import { Link } from "react-router-dom";
import { clientHref, jobHref, supplierHref } from "@/lib/recordLinks";

export default function SupplierDocCard({ doc, onChanged, highlightJobId, canReceive = false, onConfirm }: { doc: any; onChanged: () => void; highlightJobId?: string; canReceive?: boolean; onConfirm?: (doc: PendingDoc) => void }) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const run = async (fn: () => Promise<void>) => { try { await fn(); onChanged(); } catch (e: any) { toast({ title: "Failed", description: e?.message, variant: "destructive" }); } };
  const confirm = async () => {
    const { data, error } = await sb.from("supplier_job_document_lines").select("id, line_no, description, model_number, qty, received_at").eq("document_id", doc.id);
    if (error) return toast({ title: "Cannot confirm yet", description: error.message, variant: "destructive" });
    const openLines = (data ?? []).filter((l: any) => !l.received_at);
    if (!openLines.length) return toast({ title: "Already confirmed", description: "Every line on this document is already received." });
    onConfirm?.({
      id: doc.id,
      docType: doc.doc_type,
      docNo: doc.doc_number ?? "",
      poNo: doc.po_number ?? "",
      supplier: doc.suppliers?.name ?? doc.supplier_name ?? "",
      lines: openLines.map((l: any) => ({ line_no: l.line_no, description: l.description ?? "", model_number: l.model_number, qty: Number(l.qty ?? 1), unit_price_excl: null })),
    });
  };
  const supplier = doc.suppliers?.name ?? doc.supplier_name ?? "Supplier";
  const links: any[] = doc.supplier_job_document_links ?? [];
  const lines: any[] = (doc.supplier_job_document_lines ?? []).sort((a: any, b: any) => (a.line_no ?? 0) - (b.line_no ?? 0));
  return (
    <div className="rounded-xl border p-3 space-y-2" data-testid="sjd-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{doc.supplier_id ? <Link to={supplierHref(doc.supplier_id)} data-testid="sjd-supplier-link" className="text-[#1590D6] hover:underline">{supplier}</Link> : supplier} · {docTypeLabel(doc.doc_type)}{doc.doc_number ? ` ${doc.doc_number}` : ""}</div>
          <div className="text-xs text-muted-foreground">{[doc.po_number && `PO ${doc.po_number}`, doc.doc_date && new Date(doc.doc_date).toLocaleDateString("en-ZA")].filter(Boolean).join(" · ") || "No date"}{doc.source === "assistant" ? " · added by WALDA (bot)" : ""}</div>
        </div>
        {doc.storage_path && <Button size="sm" variant="outline" onClick={() => run(() => openDocFile(doc.storage_path))}><FileText className="h-4 w-4 mr-1" />Open</Button>}
        {!doc.storage_path && <label className="inline-flex"><input type="file" accept="application/pdf,image/*" className="hidden" data-testid="sjd-attach" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(() => attachDocFile(doc, f)); }} /><span className="cursor-pointer text-xs border rounded-md px-2 py-1 inline-flex items-center"><FileText className="h-4 w-4 mr-1" />Attach file</span></label>}
      </div>
      {lines.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {lines.map((l) => (
            <li key={l.id} className={l.job_id && l.job_id === highlightJobId ? "font-medium" : "text-muted-foreground"}>
              {Number(l.qty ?? 1)}× {l.model_number ?? l.description ?? "Unit"}{l.serial_number ? ` · S/N ${l.serial_number}` : ""}{l.unit_detail_id ? " · on unit record" : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {links.map((k) => (
          <Badge key={k.id} variant={k.status === "suggested" ? "outline" : "secondary"} className={`gap-1 ${k.status === "suggested" ? "border-amber-500 text-amber-700" : ""}`}>
            {k.customer_id ? <Link to={clientHref(k.customer_id)} data-testid="sjd-client-link" className="hover:underline">{k.customers?.name ?? "Client"}</Link> : (k.customers?.name ?? "Client")}
            {k.jobs?.title ? <>{" · "}{k.job_id ? <Link to={jobHref(k.job_id)} data-testid="sjd-job-link" className="hover:underline">{k.jobs.title}</Link> : k.jobs.title}</> : ""}
            <button type="button" aria-label="Remove link" onClick={() => run(() => unlinkDoc(k.id))}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {!picking && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPicking(true)}><Link2 className="h-3 w-3 mr-1" />Link job</Button>}
        {canReceive && onConfirm && (doc.doc_type === "delivery_note" || doc.doc_type === "supplier_invoice") && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" data-testid="sjd-confirm" onClick={() => { void confirm(); }}>Confirm</Button>
        )}
      </div>
      {picking && <JobPicker companyId={doc.company_id} exclude={links.map((k) => k.job_id)} onPick={(j) => { setPicking(false); run(() => linkDoc(doc.id, j.id, null)); }} />}
    </div>
  );
}
