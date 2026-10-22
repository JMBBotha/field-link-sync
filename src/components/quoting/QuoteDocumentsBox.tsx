import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Doc = { id: string; filename: string; storage_path: string; size_bytes: number | null };

/** Staff: extra PDFs that go out with the quote email and appear on the client's quote link. */
export default function QuoteDocumentsBox({ quoteId, companyId }: { quoteId: string; companyId: string | null }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const load = async () => {
    const { data } = await supabase.from("quote_documents").select("id, filename, storage_path, size_bytes").eq("quote_id", quoteId).order("created_at");
    setDocs((data as Doc[]) || []);
  };
  useEffect(() => { if (quoteId) void load(); }, [quoteId]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !companyId) return;
    setBusy(true);
    try {
      for (const f of files) {
        if (f.type !== "application/pdf") throw new Error(`${f.name} is not a PDF`);
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is bigger than 10 MB`);
        const path = `${companyId}/${quoteId}/${crypto.randomUUID()}.pdf`;
        const { error: up } = await supabase.storage.from("quote-documents").upload(path, f, { contentType: "application/pdf" });
        if (up) throw up;
        const { error } = await supabase.from("quote_documents").insert({ quote_id: quoteId, company_id: companyId, storage_path: path, filename: f.name, size_bytes: f.size });
        if (error) { await supabase.storage.from("quote-documents").remove([path]); throw error; }
      }
      toast({ title: "Document attached", description: "It will go out with the quote." });
      await load();
    } catch (err: any) {
      toast({ title: "Could not attach", description: err.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const remove = async (d: Doc) => {
    await supabase.from("quote_documents").delete().eq("id", d.id);
    await supabase.storage.from("quote-documents").remove([d.storage_path]);
    setDocs((x) => x.filter((y) => y.id !== d.id));
  };

  const open = async (d: Doc) => {
    const { data } = await supabase.storage.from("quote-documents").createSignedUrl(d.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 print:hidden" data-pdf-hide data-html2canvas-ignore>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Documents for client</span>
        <Button variant="outline" size="sm" disabled={busy || !companyId} asChild>
          <label className="cursor-pointer">
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
            {busy ? "Uploading…" : "Attach PDF"}
            <input type="file" accept="application/pdf" multiple className="hidden" onChange={upload} />
          </label>
        </Button>
      </div>
      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Attached PDFs are emailed with the quote and can be downloaded from the client's quote link.</p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <button type="button" className="truncate text-left hover:underline" onClick={() => void open(d)}>{d.filename}</button>
              <button type="button" aria-label={`Remove ${d.filename}`} className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => void remove(d)}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
