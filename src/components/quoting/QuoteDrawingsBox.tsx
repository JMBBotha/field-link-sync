import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, PencilRuler, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import {
  deleteQuoteDrawing, listQuoteDrawings, setDrawingIncluded, signedDrawingUrl, uploadQuoteDrawing, type QuoteDrawing,
} from "@/lib/drawings/quoteDrawings";

const ICON = { pdf: FileText, png: ImageIcon, boq_csv: FileSpreadsheet } as const;

/**
 * Staff: HVAC drawings on this quote (Johan 26 Oct 19:36, option A).
 * Ticked PDF/PNG drawings are appended after the quote in the client PDF; BOQ CSVs stay internal.
 * Hidden until the quote_drawings table exists, so it is safe to ship ahead of the migration.
 */
export default function QuoteDrawingsBox({ quoteId, companyId }: { quoteId: string; companyId: string | null }) {
  const [rows, setRows] = useState<QuoteDrawing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const { isAdmin } = useRole();

  const load = async () => {
    try { setRows(await listQuoteDrawings(quoteId)); } catch { setRows(null); }
  };
  useEffect(() => { if (quoteId) void load(); }, [quoteId]);
  if (rows === null) return null;

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !companyId) return;
    setBusy(true);
    try {
      for (const f of files) await uploadQuoteDrawing(f, quoteId, companyId);
      toast({ title: "Drawing added", description: "Ticked drawings print after the quote." });
      await load();
    } catch (err: any) {
      toast({ title: "Could not add drawing", description: err.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const toggle = async (d: QuoteDrawing, v: boolean) => {
    setRows((x) => x?.map((y) => (y.id === d.id ? { ...y, include_in_client_pdf: v } : y)) ?? x);
    try { await setDrawingIncluded(d.id, v); } catch (err: any) {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
      void load();
    }
  };

  const remove = async (d: QuoteDrawing) => {
    if (!window.confirm(`Delete ${d.filename}?`)) return;
    try { await deleteQuoteDrawing(d); setRows((x) => x?.filter((y) => y.id !== d.id) ?? x); } catch (err: any) {
      toast({ title: "Could not delete", description: err.message, variant: "destructive" });
    }
  };

  const open = async (d: QuoteDrawing) => {
    const url = await signedDrawingUrl(d.storage_path);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 print:hidden" data-pdf-hide data-html2canvas-ignore data-testid="quote-drawings">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold"><PencilRuler className="h-4 w-4 text-primary" />Drawings</span>
        <Button variant="outline" size="sm" disabled={busy || !companyId} asChild>
          <label className="cursor-pointer">
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PencilRuler className="mr-1 h-4 w-4" />}
            {busy ? "Uploading…" : "Add drawing"}
            <input type="file" accept="application/pdf,image/png,.csv,text/csv" multiple className="hidden" onChange={upload} />
          </label>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">HVAC layouts (PDF or PNG) print after the quote. BOQ spreadsheets stay internal.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((d) => {
            const Icon = ICON[d.kind];
            const boq = d.kind === "boq_csv";
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => void open(d)}>{d.filename}</button>
                {d.revision && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{d.revision}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {boq ? (
                    <span>Internal only</span>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox checked={d.include_in_client_pdf} onCheckedChange={(v) => void toggle(d, v === true)} aria-label={`Include ${d.filename} in client PDF`} />
                      In client PDF
                    </label>
                  )}
                  {isAdmin && (
                    <button type="button" aria-label={`Delete ${d.filename}`} className="text-muted-foreground hover:text-destructive" onClick={() => void remove(d)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
