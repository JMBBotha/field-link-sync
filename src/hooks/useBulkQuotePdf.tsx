import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import ClientQuotePdfRoot from "@/components/quoting/ClientQuotePdfRoot";
import { savePdfFile } from "@/components/quoting/QuotePdfViewer";
import {
  BULK_QUOTE_PDF_CAP,
  combinedQuotePdfName,
  mergePdfBlobs,
  quotePdfPriceBlockMessage,
} from "@/lib/bulkQuotePdf";
import { renderClientQuotePdfBlob } from "@/lib/renderClientQuotePdf";
import { pdfStep } from "@/lib/pdfTimeout";
import type { QuotePdfProgress } from "@/components/quoting/QuotePdfSelectionBar";

export type BulkQuoteInput = { id: string; ref: string | null; customerName: string | null };

/**
 * Combined quote PDF from the list. One quote at a time, through the same
 * client PDF the single Download PDF button uses. Reads only: no status change,
 * no email, no pdf_activity row.
 */
export function useBulkQuotePdf() {
  const { toast } = useToast();
  const { settings } = useCompanySettings();
  const [mountId, setMountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<QuotePdfProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);

  const cancel = () => { cancelRef.current = true; };

  const priceBlock = async (quoteId: string): Promise<string | null> => {
    const [areaRes, lineRes] = await Promise.all([
      supabase.from("quote_areas").select("id, name").eq("quote_id", quoteId),
      supabase.from("quote_items").select("id, area_id, parent_item_id, item_name, item_type, quantity, metadata, unit_price").eq("quote_id", quoteId),
    ]);
    if (areaRes.error) throw areaRes.error;
    if (lineRes.error) throw lineRes.error;
    const areaNames = Object.fromEntries(((areaRes.data || []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
    return quotePdfPriceBlockMessage((lineRes.data || []) as Parameters<typeof quotePdfPriceBlockMessage>[0], areaNames);
  };

  const download = async (rows: BulkQuoteInput[]) => {
    if (busyRef.current) return;
    if (!rows.length) return;
    if (rows.length > BULK_QUOTE_PDF_CAP) {
      toast({ title: `Choose ${BULK_QUOTE_PDF_CAP} or fewer quotes`, variant: "destructive" });
      return;
    }
    busyRef.current = true;
    cancelRef.current = false;
    setBusy(true);
    setProblem(null);
    const made: Blob[] = [];
    const failed: string[] = [];
    const warnings: string[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        if (cancelRef.current) break;
        const row = rows[i];
        const label = row.ref || "Quote";
        setProgress({ current: i + 1, total: rows.length });
        setMountId(null);
        try {
          const blocked = await priceBlock(row.id);
          if (cancelRef.current) break;
          if (blocked) { failed.push(`${label}: ${blocked}`); continue; }
          setMountId(row.id);
          const { blob } = await pdfStep(renderClientQuotePdfBlob({
            quoteId: row.id,
            companyName: settings.company_name || "0800-BE-COOL",
            companyAddress: settings.physical_address,
            vatNumber: settings.vat_number,
            onWarning: (msg) => warnings.push(`${label}: ${msg}`),
          }), 120000, "building the PDF");
          made.push(blob);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Could not build the PDF";
          failed.push(`${label}: ${message}`);
        } finally {
          setMountId(null);
        }
      }
      if (cancelRef.current) {
        toast({ title: "Download cancelled" });
        return;
      }
      if (!made.length) {
        const text = failed.join(" · ");
        setProblem(text);
        toast({ title: "No PDF was made", description: failed.slice(0, 3).join(" "), variant: "destructive" });
        return;
      }
      const merged = await mergePdfBlobs(made);
      const fileName = combinedQuotePdfName(rows.map((r) => r.customerName));
      const url = URL.createObjectURL(merged);
      let saved: Awaited<ReturnType<typeof savePdfFile>> = "downloaded";
      try { saved = await savePdfFile(url, fileName); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      if (saved === "cancelled") {
        toast({ title: "Download cancelled" });
        return;
      }
      if (failed.length || warnings.length) {
        const text = [...failed, ...warnings].join(" · ");
        setProblem(text);
        toast({
          title: failed.length ? `PDF downloaded. ${failed.length} left out` : "PDF downloaded",
          description: text,
        });
      } else {
        toast({ title: "PDF downloaded", description: fileName });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not build the PDF";
      setProblem(message);
      toast({ title: "No PDF was made", description: message, variant: "destructive" });
    } finally {
      setMountId(null);
      setProgress(null);
      setBusy(false);
      busyRef.current = false;
    }
  };

  const portal = mountId ? <ClientQuotePdfRoot key={mountId} quoteId={mountId} /> : null;
  return { download, cancel, busy, progress, problem, portal, cap: BULK_QUOTE_PDF_CAP };
}
