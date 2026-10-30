import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Lock } from "lucide-react";
import { sb, SJD_BUCKET, DOC_TYPES, linkDoc } from "./api";
import JobPicker from "./JobPicker";

type Line = { description: string; model_number: string; serial_number: string; qty: string };

export default function AddSupplierDocDialog({ open, onOpenChange, companyId, jobId, customerId, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string; jobId?: string | null; customerId?: string | null; onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [supplier, setSupplier] = useState("");
  const [docType, setDocType] = useState("delivery_note");
  const [docNo, setDocNo] = useState("");
  const [poNo, setPoNo] = useState("");
  const [docDate, setDocDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<Line[]>([{ description: "", model_number: "", serial_number: "", qty: "1" }]);
  const [extraJobs, setExtraJobs] = useState<any[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const save = async () => {
    setBusy(true);
    try {
      const cleanLines = lines.filter((l) => l.description || l.model_number || l.serial_number);
      const { data, error } = await sb.rpc("sjd_ingest", {
        p_company_id: companyId,
        p_doc: { supplier_name: supplier || null, doc_type: docType, doc_number: docNo || null, po_number: poNo || null, doc_date: docDate || null, file_name: file?.name ?? null, mime_type: file?.type ?? null },
        p_lines: cleanLines,
        p_source_ref: null,
      });
      if (error) throw error;
      const docId = data.document_id as string;
      if (file) {
        const path = `${companyId}/${docId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const up = await sb.storage.from(SJD_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (up.error) throw up.error;
        const { error: e2 } = await sb.from("supplier_job_documents").update({ storage_path: path, updated_at: new Date().toISOString() }).eq("id", docId);
        if (e2) throw e2;
      }
      if (jobId) await linkDoc(docId, jobId, null);
      else if (customerId) await linkDoc(docId, null, customerId);
      for (const j of extraJobs) await linkDoc(docId, j.id, null);
      toast({ title: "Supplier document saved", description: data.suggested ? `${data.suggested} other possible job match(es) are waiting in Needs linking.` : undefined });
      onOpenChange(false);
      setSupplier(""); setDocNo(""); setPoNo(""); setDocDate(""); setFile(null); setExtraJobs([]);
      setLines([{ description: "", model_number: "", serial_number: "", qty: "1" }]);
      onSaved?.();
    } catch (e: any) {
      toast({ title: "Could not save document", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Add supplier document</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Private to office staff. Clients, reps and techs never see it.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Supplier</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Samsung" data-testid="sjd-supplier" /></div>
          <div><Label>Type</Label>
            <select className="w-full h-10 rounded-md border bg-background px-2 text-sm" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><Label>Date</Label><Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
          <div><Label>Doc number</Label><Input value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
          <div><Label>PO number</Label><Input value={poNo} onChange={(e) => setPoNo(e.target.value)} /></div>
          <div className="col-span-2"><Label>File (PDF or photo)</Label><Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        </div>
        <div className="space-y-2">
          <Label>Units on this document</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <Input className="col-span-5" placeholder="Model no." value={l.model_number} onChange={(e) => setLine(i, "model_number", e.target.value)} />
              <Input className="col-span-5" placeholder="Serial no." value={l.serial_number} onChange={(e) => setLine(i, "serial_number", e.target.value)} />
              <Input className="col-span-2 px-2" placeholder="Qty" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} />
              <Input className="col-span-11" placeholder="Description (optional)" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
              <button type="button" aria-label="Remove line" className="col-span-1 justify-self-center" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { description: "", model_number: "", serial_number: "", qty: "1" }])}><Plus className="h-4 w-4 mr-1" /> Add unit</Button>
        </div>
        <div className="space-y-2">
          <Label>Also covers these jobs</Label>
          <div className="flex flex-wrap gap-1.5">
            {extraJobs.map((j) => (
              <Badge key={j.id} variant="secondary" className="gap-1">{j.customers?.name ?? "Client"} · {j.title}
                <button type="button" aria-label="Remove" onClick={() => setExtraJobs((x) => x.filter((y) => y.id !== j.id))}><X className="h-3 w-3" /></button></Badge>
            ))}
          </div>
          {picking ? <JobPicker companyId={companyId} exclude={[jobId ?? "", ...extraJobs.map((j) => j.id)]} onPick={(j) => { setExtraJobs((x) => [...x, j]); setPicking(false); }} />
            : <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)} data-testid="sjd-add-job"><Plus className="h-4 w-4 mr-1" /> Add another job</Button>}
        </div>
        <DialogFooter><Button onClick={save} disabled={busy} data-testid="sjd-save">{busy ? "Saving…" : "Save document"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
