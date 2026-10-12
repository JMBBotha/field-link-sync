import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus, Download, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { fetchCompanyProfile } from "@/lib/companyProfiles";
import { buildPurchaseOrderPdf, PO_DOCS_LINE, type PoRow } from "@/lib/purchaseOrderPdf";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

interface DocRow { id: string; po_id: string; doc_type: string; file_name: string | null; storage_path: string; created_at: string }

/** Office-only. Manual draft supplier POs for a paid invoice. Nothing is emailed from here. */
export default function PurchaseOrdersPanel({ invoice }: { invoice: any }) {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState(false);
  const [pos, setPos] = useState<PoRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await db.from("purchase_orders")
      .select("*, supplier:suppliers(name, main_phone), items:purchase_order_items(model_code, description, qty, unit_cost_excl_vat, line_total_excl_vat, sort_order)")
      .eq("invoice_id", invoice.id).order("seq");
    const rows = ((data || []) as any[]).map((p) => ({ ...p, invoice_number: invoice.invoice_number,
      items: (p.items || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }));
    setPos(rows);
    if (rows.length) {
      const { data: d } = await db.from("purchase_order_documents").select("id, po_id, doc_type, file_name, storage_path, created_at")
        .in("po_id", rows.map((r) => r.id)).order("created_at");
      setDocs(d || []);
    } else setDocs([]);
  }, [invoice.id, invoice.invoice_number]);

  useEffect(() => {
    if (!invoice?.company_id) return;
    db.rpc("po_office_ok", { _company: invoice.company_id }).then(({ data }: any) => {
      setAllowed(!!data);
      if (data) load();
    });
  }, [invoice?.company_id, invoice?.status, load]);

  if (!allowed || (invoice.status !== "paid" && pos.length === 0)) return null;

  const create = async () => {
    setBusy(true);
    const { data, error } = await db.rpc("create_draft_pos_for_invoice", { p_invoice: invoice.id });
    setBusy(false);
    if (error) return toast({ title: "No POs created", description: error.message, variant: "destructive" });
    const n = (data?.created || []).length;
    const unl = Number(data?.unlinked_unit_lines || 0);
    toast({ title: n ? `${n} draft PO${n > 1 ? "s" : ""} created` : "Nothing new to order",
      description: [n ? (data.created as any[]).map((c) => c.po_number).join(", ") : "Every supplier already has a PO for this invoice.",
        unl ? `${unl} unit line(s) are not linked to a catalogue product and were skipped.` : ""].filter(Boolean).join(" ") });
    load();
  };

  const download = async (po: PoRow) => {
    const prof = await fetchCompanyProfile(invoice.company_profile_id);
    buildPurchaseOrderPdf(po, prof).save(`${po.po_number}.pdf`);
  };

  const upload = async (po: PoRow, docType: string, file: File) => {
    const path = `${invoice.company_id}/${po.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("po-documents").upload(path, file, { upsert: false });
    if (up.error) return toast({ title: "Upload failed", description: up.error.message, variant: "destructive" });
    const { error } = await db.from("purchase_order_documents").insert({ company_id: invoice.company_id, po_id: po.id,
      supplier_id: (po as any).supplier_id, job_id: (po as any).job_id, customer_id: (po as any).customer_id,
      doc_type: docType, storage_path: path, file_name: file.name, internal_only: true });
    if (error) { await supabase.storage.from("po-documents").remove([path]); return toast({ title: "Upload failed", description: error.message, variant: "destructive" }); }
    toast({ title: "Saved (internal only)" });
    load();
  };

  const openDoc = async (d: DocRow) => {
    const { data, error } = await supabase.storage.from("po-documents").createSignedUrl(d.storage_path, 300);
    if (error || !data) return toast({ title: "Could not open file", description: error?.message, variant: "destructive" });
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const picker = (po: PoRow, docType: string, label: string) => (
    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
      <Upload className="h-3 w-3" /> {label}
      <input type="file" className="hidden" accept="application/pdf,image/*"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(po, docType, f); }} />
    </label>
  );

  return (
    <Card className="print:hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Supplier purchase orders</p>
            <p className="text-xs text-muted-foreground">Internal only. Drafts are never emailed from here.</p>
          </div>
          {invoice.status === "paid" && (
            <Button size="sm" onClick={create} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-1 h-4 w-4" />} Create draft POs
            </Button>
          )}
        </div>
        {pos.length === 0 && <p className="text-sm text-muted-foreground">No POs yet.</p>}
        {pos.map((po) => (
          <div key={po.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{po.po_number}</span>{" "}
                <Badge variant="secondary" className="ml-1 capitalize">{po.status}</Badge>
                <div className="truncate text-xs text-muted-foreground">
                  {po.supplier?.name?.trim()}{po.supplier_account_number ? ` · acc ${po.supplier_account_number}` : ""} · {(po.supplier_emails || []).join(", ")}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => download(po)}><Download className="mr-1 h-3 w-3" /> PDF</Button>
            </div>
            <ul className="text-xs">
              {po.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-2"><span className="truncate">{Number(it.qty)} × {it.model_code}</span>
                  <span>R {Number(it.line_total_excl_vat).toLocaleString("en-ZA", { minimumFractionDigits: 2 })} excl</span></li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">{PO_DOCS_LINE}</p>
            <div className="flex flex-wrap gap-2">
              {picker(po, "supplier_invoice", "Supplier invoice")}
              {picker(po, "delivery_note", "Delivery note")}
            </div>
            {docs.filter((d) => d.po_id === po.id).map((d) => (
              <button key={d.id} onClick={() => openDoc(d)} className="flex items-center gap-1 text-xs text-primary underline">
                <FileText className="h-3 w-3" /> {d.doc_type === "delivery_note" ? "Delivery note" : d.doc_type === "supplier_invoice" ? "Supplier invoice" : "File"}: {d.file_name}
              </button>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
