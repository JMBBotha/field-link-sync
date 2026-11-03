import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { sb } from "@/components/supplierDocs/api";
import { pdfTextPages } from "@/lib/pdfTextLines";
import { parsePagesLocally, productLinesOnly } from "../../../supabase/functions/_shared/supplierDocLines";
import { buildPreview, canConfirm, normaliseModel, toReceivePayload, type CodeAlias, type DocType, type ExtractedLine, type PreviewRow, type Product } from "@/lib/stockReceive";
import ReceivePreviewTable, { type JobOption } from "./ReceivePreviewTable";
import ReceiveReconTable from "./ReceiveReconTable";
import { buildRecon, type JobQuoteLine } from "@/lib/stockRecon";

const PRODUCT_COLS = "id, product_code, short_name, name, description, price_per_unit_label, sold_in_length, unit_length, cost_price, product_type";

/** Admin only (button hidden unless cf_can_receive; sjd_receive re-checks). Upload → read product lines on device → preview → confirm. */
export default function ReceiveSupplierDocDialog({ open, onOpenChange, companyId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string; onSaved?: () => void }) {
  const { toast } = useToast();
  const [docType, setDocType] = useState<DocType>("delivery_note");
  const [docNo, setDocNo] = useState(""); const [poNo, setPoNo] = useState(""); const [supplier, setSupplier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<ExtractedLine[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: products = [] } = useQuery({ queryKey: ["receive-products", companyId], enabled: open,
    queryFn: async () => ((await sb.from("supplier_products").select(PRODUCT_COLS).limit(5000)).data ?? []) as Product[] });
  const { data: aliases = [] } = useQuery({ queryKey: ["receive-code-aliases", companyId], enabled: open,
    // Table may not exist before its migration is applied: fall back to no aliases.
    queryFn: async () => { const { data, error } = await (sb as any).from("supplier_product_code_aliases").select("product_id, supplier_code, half, supplier_name").eq("active", true).limit(5000); return (error ? [] : data ?? []) as CodeAlias[]; } });
  const { data: jobs = [] } = useQuery({ queryKey: ["receive-jobs", companyId], enabled: open,
    queryFn: async () => (((await sb.from("jobs").select("id, title, status, quote_id").neq("status", "cancelled").order("created_at", { ascending: false }).limit(150)).data ?? []) as any[])
      .map((j) => ({ id: j.id, label: j.title || j.id.slice(0, 8), quote_id: j.quote_id ?? null, has_quote: !!j.quote_id })) as (JobOption & { quote_id: string | null; has_quote: boolean })[] });
  const jobIds = useMemo(() => [...new Set(rows.filter((r) => (r.action === "reserve" || r.action === "installed") && r.job_id).map((r) => r.job_id as string))].sort(), [rows]);
  const { data: quoteLines = [], isFetching: quoteLoading } = useQuery({ queryKey: ["receive-quote-lines", jobIds.join(",")], enabled: open && jobIds.length > 0,
    queryFn: async () => {
      const qmap = new Map(jobs.filter((j) => jobIds.includes(j.id) && j.quote_id).map((j) => [j.quote_id as string, j.id]));
      if (!qmap.size) return [] as JobQuoteLine[];
      const { data, error } = await sb.from("quote_items").select("quote_id, product_id, quantity").in("quote_id", [...qmap.keys()]);
      if (error) throw error;
      return (data ?? []).map((q: any) => ({ job_id: qmap.get(q.quote_id)!, product_id: q.product_id, quantity: Number(q.quantity ?? 0) })) as JobQuoteLine[];
    } });

  const read = async () => {
    if (!file) return;
    setBusy("Reading product lines…");
    try {
      const pages = await pdfTextPages(file);
      let got = parsePagesLocally(pages);
      if (!got.length || got.some((l) => !l.model_number)) {
        // Only the filtered product rows are sent (POPIA). Scanned PDFs without text need manual entry.
        const safe = productLinesOnly(pages.flat());
        if (safe.length) {
          const { data, error } = await sb.functions.invoke("extract-supplier-doc", { body: { lines: safe } });
          if (error) throw error;
          if (data?.lines?.length) got = data.lines;
        }
      }
      if (!got.length) throw new Error("No product lines found (scanned PDF?). Add the lines by hand on the document.");
      let earlier: any[] = [];
      if (docType === "supplier_invoice" && poNo.trim()) {
        const { data } = await sb.from("supplier_job_document_lines").select("product_id, model_number, unit_cost_excl, receive_action, receive_job_id, supplier_job_documents!inner(po_number, doc_type)")
          .eq("supplier_job_documents.po_number", poNo.trim()).eq("supplier_job_documents.doc_type", "delivery_note");
        earlier = (data ?? []).map((e: any) => ({ ...e, normalised: normaliseModel(e.model_number) }));
      }
      setLines(got); setRows(buildPreview(docType, got, products, earlier, null, aliases));
    } catch (e: any) { toast({ title: "Could not read document", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!buildRecon(rows, jobs, quoteLines).ok) return;
    setBusy("Saving…");
    try {
      const { data: ing, error } = await sb.rpc("sjd_ingest", { p_company_id: companyId, p_doc: { supplier_name: supplier || null, doc_type: docType, doc_number: docNo || null, po_number: poNo || null, file_name: file?.name ?? null },
        p_lines: lines.map((l) => ({ description: l.description, model_number: l.model_number, qty: l.qty })), p_source_ref: docNo ? `upload:${docType}:${docNo}` : null });
      if (error) throw error;
      const { data: dl } = await sb.from("supplier_job_document_lines").select("id, line_no").eq("document_id", ing.document_id);
      const ids: Record<number, string> = {}; (dl ?? []).forEach((l: any) => { ids[l.line_no] = l.id; });
      const { data: res, error: e2 } = await sb.rpc("sjd_receive", { p_document: ing.document_id, p_lines: toReceivePayload(rows, ids) });
      if (e2) throw e2;
      toast({ title: docType === "supplier_invoice" ? `Stock added: ${res.stocked} line(s)` : "Delivery note recorded", description: `${res.reserved} reserved for jobs · ${res.installed} installed${res.already_received ? ` · ${res.already_received} already received` : ""}` });
      onSaved?.(); onOpenChange(false); setRows([]); setLines([]); setFile(null);
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const recon = useMemo(() => buildRecon(rows, jobs, jobIds.length ? quoteLines : []), [rows, jobs, quoteLines, jobIds]);
  const ok = useMemo(() => canConfirm(rows) && recon.ok && !quoteLoading, [rows, recon, quoteLoading]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Receive delivery note / invoice</DialogTitle></DialogHeader>
        <ReceiveForm {...{ docType, setDocType, docNo, setDocNo, poNo, setPoNo, supplier, setSupplier, file, setFile }} onRead={read} busy={busy} />
        {rows.length > 0 && <>
          <ReceivePreviewTable rows={rows} jobs={jobs} isInvoice={docType === "supplier_invoice"} onChange={(i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch, adds_stock: docType === "supplier_invoice" && ["stock", "reserve"].includes((patch.action ?? r.action) as string) } : r)))} />
          <ReceiveReconTable recon={recon} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRows([])}>Back</Button><Button disabled={!ok || !!busy} onClick={confirm}>{docType === "supplier_invoice" ? "Confirm and add stock" : "Confirm delivery note"}</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

export function ReceiveForm(p: { docType: DocType; setDocType: (v: DocType) => void; docNo: string; setDocNo: (v: string) => void; poNo: string; setPoNo: (v: string) => void; supplier: string; setSupplier: (v: string) => void; file: File | null; setFile: (f: File | null) => void; onRead: () => void; busy: string | null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label="Document type" className="h-9 rounded-md border bg-background px-2 text-sm" value={p.docType} onChange={(e) => p.setDocType(e.target.value)}>
        <option value="delivery_note">Delivery note (no stock added)</option><option value="supplier_invoice">Supplier invoice (adds stock)</option>
      </select>
      <Input placeholder="Supplier" value={p.supplier} onChange={(e) => p.setSupplier(e.target.value)} />
      <Input placeholder="Document number" value={p.docNo} onChange={(e) => p.setDocNo(e.target.value)} />
      <Input placeholder="PO / SO number (links invoice to delivery note)" value={p.poNo} onChange={(e) => p.setPoNo(e.target.value)} />
      <Input type="file" accept="application/pdf" className="sm:col-span-1" onChange={(e) => p.setFile(e.target.files?.[0] ?? null)} />
      <Button onClick={p.onRead} disabled={!p.file || !!p.busy}>{p.busy ?? "Read product lines"}</Button>
      <p className="sm:col-span-2 text-[11px] text-muted-foreground">Read on this device. Only product rows (code, description, qty, price) are ever sent for AI help; names, addresses and phone numbers are removed first.</p>
    </div>
  );
}
