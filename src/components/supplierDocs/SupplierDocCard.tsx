import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileText, Check, X, Link2 } from "lucide-react";
import { docTypeLabel, openDocFile, linkDoc, unlinkDoc, attachDocFile } from "./api";
import JobPicker from "./JobPicker";

export default function SupplierDocCard({ doc, onChanged, highlightJobId }: { doc: any; onChanged: () => void; highlightJobId?: string }) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const run = async (fn: () => Promise<void>) => { try { await fn(); onChanged(); } catch (e: any) { toast({ title: "Failed", description: e?.message, variant: "destructive" }); } };
  const supplier = doc.suppliers?.name ?? doc.supplier_name ?? "Supplier";
  const links: any[] = doc.supplier_job_document_links ?? [];
  const lines: any[] = (doc.supplier_job_document_lines ?? []).sort((a: any, b: any) => (a.line_no ?? 0) - (b.line_no ?? 0));
  return (
    <div className="rounded-xl border p-3 space-y-2" data-testid="sjd-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{supplier} · {docTypeLabel(doc.doc_type)}{doc.doc_number ? ` ${doc.doc_number}` : ""}</div>
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
            {k.status === "suggested" && "Suggested: "}{k.customers?.name ?? "Client"}{k.jobs?.title ? ` · ${k.jobs.title}` : ""}
            {k.status === "suggested" && <button type="button" aria-label="Confirm link" title={k.reason ?? ""} onClick={() => run(() => linkDoc(doc.id, k.job_id, k.customer_id))}><Check className="h-3 w-3" /></button>}
            <button type="button" aria-label="Remove link" onClick={() => run(() => unlinkDoc(k.id))}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {!picking && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPicking(true)}><Link2 className="h-3 w-3 mr-1" />Link job</Button>}
      </div>
      {picking && <JobPicker companyId={doc.company_id} exclude={links.map((k) => k.job_id)} onPick={(j) => { setPicking(false); run(() => linkDoc(doc.id, j.id, null)); }} />}
    </div>
  );
}
