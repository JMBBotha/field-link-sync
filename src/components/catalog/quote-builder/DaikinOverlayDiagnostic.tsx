import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stethoscope, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Step = {
  label: string;
  ok: boolean;
  detail: string;
};

interface Props {
  currentSupplierName: string;
  currentPageNumber: number | null;
}

/**
 * One-click diagnostic that traces a product code from the supplier_products table
 * through to the overlay-region pipeline used by VisualCatalogPanel / PdfPageOverlay.
 *
 * Reports, in order:
 *  1. supplier name resolves to a UUID
 *  2. supplier_products row exists for the product code
 *  3. row has page_number + row_bbox populated
 *  4. row matches the currently-viewed page
 *  5. row_bbox values are normalized (0–1) and non-zero
 */
export const DaikinOverlayDiagnostic = ({ currentSupplierName, currentPageNumber }: Props) => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [rawRow, setRawRow] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    setRawRow(null);
    const out: Step[] = [];

    // Step 1: resolve supplier UUID
    const trimmed = (currentSupplierName || "").trim();
    if (!trimmed) {
      out.push({ label: "Resolve supplier", ok: false, detail: "No current supplier selected" });
      setSteps(out); setRunning(false); return;
    }
    const { data: supplierRow, error: sErr } = await (supabase.from("suppliers") as any)
      .select("id, name")
      .ilike("name", trimmed)
      .maybeSingle();
    if (sErr || !supplierRow?.id) {
      out.push({ label: "Resolve supplier UUID", ok: false, detail: `No suppliers row matches "${trimmed}"` });
      setSteps(out); setRunning(false); return;
    }
    out.push({ label: "Resolve supplier UUID", ok: true, detail: `${supplierRow.name} → ${supplierRow.id}` });
    setSteps([...out]);

    // Step 2: find product row
    const productCode = code.trim();
    if (!productCode) {
      out.push({ label: "Lookup product_code", ok: false, detail: "No product code entered" });
      setSteps(out); setRunning(false); return;
    }
    const { data: prod } = await (supabase.from("supplier_products") as any)
      .select("id, product_code, short_name, page_number, row_bbox, price_bbox")
      .eq("supplier_id", supplierRow.id)
      .ilike("product_code", productCode)
      .maybeSingle();
    if (!prod) {
      out.push({ label: "Lookup product_code", ok: false, detail: `No supplier_products row for "${productCode}" under this supplier` });
      setSteps(out); setRunning(false); return;
    }
    setRawRow(prod);
    out.push({ label: "Lookup product_code", ok: true, detail: `${prod.product_code} — ${prod.short_name || "(no name)"}` });
    setSteps([...out]);

    // Step 3: page_number + row_bbox populated
    const hasBbox = prod.row_bbox && typeof prod.row_bbox === "object";
    if (!prod.page_number) {
      out.push({ label: "page_number stored", ok: false, detail: "page_number is NULL — overlay cannot map to a page" });
      setSteps(out); setRunning(false); return;
    }
    out.push({ label: "page_number stored", ok: true, detail: `page_number = ${prod.page_number}` });

    if (!hasBbox) {
      out.push({ label: "row_bbox stored", ok: false, detail: "row_bbox is NULL — OCR fallback has no coords" });
      setSteps(out); setRunning(false); return;
    }
    out.push({ label: "row_bbox stored", ok: true, detail: JSON.stringify(prod.row_bbox) });
    setSteps([...out]);

    // Step 4: matches currently-viewed page
    if (currentPageNumber == null) {
      out.push({ label: "Matches current page", ok: false, detail: "No current page index in panel" });
    } else if (Number(prod.page_number) !== Number(currentPageNumber)) {
      out.push({
        label: "Matches current page",
        ok: false,
        detail: `Stored page=${prod.page_number}, viewing page=${currentPageNumber}. Switch to page ${prod.page_number} to see overlay.`,
      });
    } else {
      out.push({ label: "Matches current page", ok: true, detail: `Both = ${currentPageNumber}` });
    }
    setSteps([...out]);

    // Step 5: bbox sanity
    const rb = prod.row_bbox as any;
    const x = Number(rb.x ?? rb.x_pct);
    const y = Number(rb.y ?? rb.y_pct);
    const w = Number(rb.width ?? rb.w ?? rb.w_pct);
    const h = Number(rb.height ?? rb.h ?? rb.h_pct);
    const allPresent = [x, y, w, h].every(v => Number.isFinite(v));
    const inRange = allPresent && x >= 0 && x <= 1 && y >= 0 && y <= 1 && w > 0 && w <= 1 && h > 0 && h <= 1;
    if (!allPresent) {
      out.push({ label: "bbox shape valid", ok: false, detail: `Missing fields. Got: ${JSON.stringify(rb)}` });
    } else if (!inRange) {
      out.push({
        label: "bbox values in [0..1]",
        ok: false,
        detail: `x=${x} y=${y} w=${w} h=${h} — values outside normalized range`,
      });
    } else {
      out.push({
        label: "bbox normalized [0..1]",
        ok: true,
        detail: `x=${x.toFixed(3)} y=${y.toFixed(3)} w=${w.toFixed(3)} h=${h.toFixed(3)}`,
      });
    }
    setSteps([...out]);
    setRunning(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="Diagnose overlay for a product"
        onClick={() => setOpen(true)}
      >
        <Stethoscope className="h-3.5 w-3.5 text-primary" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Overlay Diagnostic</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-2 bg-muted/30 text-xs space-y-0.5">
              <div><span className="text-muted-foreground">Supplier:</span> <span className="font-mono">{currentSupplierName || "(none)"}</span></div>
              <div><span className="text-muted-foreground">Viewing page:</span> <span className="font-mono">{currentPageNumber ?? "(none)"}</span></div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="diag-code">Product code</Label>
              <div className="flex gap-2">
                <Input
                  id="diag-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. FTXM35A"
                  onKeyDown={(e) => { if (e.key === "Enter") run(); }}
                />
                <Button onClick={run} disabled={running || !code.trim()}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Trace"}
                </Button>
              </div>
            </div>

            {steps.length > 0 && (
              <div className="space-y-1.5 border rounded-md p-2">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {s.ok
                      ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                      : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{s.label}</div>
                      <div className="text-muted-foreground break-words font-mono text-[11px]">{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rawRow && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Raw supplier_products row</summary>
                <pre className="mt-2 p-2 bg-muted rounded overflow-auto text-[10px] max-h-48">{JSON.stringify(rawRow, null, 2)}</pre>
              </details>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DaikinOverlayDiagnostic;
