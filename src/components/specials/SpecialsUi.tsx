import { useCallback, useRef, useState } from "react";
import { Tag, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatRand } from "@/utils/formatRand";
import { fmtDate, signedSpecialsPdfUrl, type SupplierSpecial } from "@/lib/specials";

/** In-app preview of a specials PDF via a short-lived signed URL. */
export function SpecialsPdfDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const last = useRef<string | null>(null);
  if (path && last.current !== path) {
    last.current = path;
    setUrl(null); setErr(false);
    void signedSpecialsPdfUrl(path).then((u) => (u ? setUrl(u) : setErr(true)));
  }
  if (!path && last.current) last.current = null;
  return (
    <Dialog open={!!path} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-3">
        <DialogHeader><DialogTitle>Specials PDF</DialogTitle></DialogHeader>
        {err ? <p className="text-sm text-destructive">Couldn't open the PDF.</p>
          : url ? <iframe title="Specials PDF" src={url} className="flex-1 w-full rounded border" />
          : <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      </DialogContent>
    </Dialog>
  );
}

/** Staff-only row indicator. Never printed / never captured into the client PDF. */
export function SpecialChip({ cost, endDate, pdfPath, applied }: { cost: number; endDate: string; pdfPath?: string | null; applied?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <span data-html2canvas-ignore data-testid="special-chip" className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-emerald-400 bg-emerald-50 px-1.5 text-[10px] text-emerald-800 print:hidden">
      <Tag className="h-2.5 w-2.5" />
      {applied ? "Special applied: " : "Special: "}{formatRand(cost)} until {fmtDate(endDate)}
      {pdfPath && (
        <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(pdfPath); }}>
          View specials PDF
        </button>
      )}
      <SpecialsPdfDialog path={open} onClose={() => setOpen(null)} />
    </span>
  );
}

/** ask(special, normalCost) → Promise<boolean>: Yes = use special cost on this quote line only. */
export function useSpecialPrompt() {
  const [state, setState] = useState<{ s: SupplierSpecial; normal: number; resolve: (v: boolean) => void } | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const ask = useCallback((s: SupplierSpecial, normal: number) =>
    new Promise<boolean>((resolve) => setState({ s, normal, resolve })), []);
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const dialog = (
    <>
      <Dialog open={!!state} onOpenChange={(o) => !o && done(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-emerald-600" /> On special</DialogTitle>
            {state && (
              <DialogDescription>
                {state.s.model_number}: this model is on special: cost {formatRand(Number(state.s.special_cost))} (normal {formatRand(state.normal)}) until {fmtDate(state.s.end_date)}. Use special cost for this quote?
              </DialogDescription>
            )}
          </DialogHeader>
          {state?.s.specials_pdf_path && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-primary underline" onClick={() => setPdf(state.s.specials_pdf_path)}>
              <FileText className="h-4 w-4" /> View specials PDF
            </button>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => done(false)}>No, keep normal</Button>
            <Button onClick={() => done(true)}>Yes, use special</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SpecialsPdfDialog path={pdf} onClose={() => setPdf(null)} />
    </>
  );
  return { ask, dialog };
}
