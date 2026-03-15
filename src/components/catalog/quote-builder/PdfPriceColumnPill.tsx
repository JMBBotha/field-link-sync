/**
 * PdfPriceColumnPill — renders a green pill badge aligned with the detected
 * price-column header on each supplier's PDF page.
 *
 * Each page independently detects its header position via text extraction,
 * since column layouts vary between PDFs. Falls back to a configured x-coordinate.
 */

import { useState, useEffect, memo } from "react";
import { getSupplierPriceColumnConfig } from "@/config/supplierPriceColumns";
import { extractTextItemsFromPdfPage } from "./pdfTextExtractor";

interface PdfPriceColumnPillProps {
  supplierName: string;
  pdfStoragePath: string | null;
  pageNumber: number;
}

interface PillPos {
  xPct: number;  // center-x as page-width percentage
  yPct: number;  // top of pill as page-height percentage
}

const PdfPriceColumnPill = memo(({ supplierName, pdfStoragePath, pageNumber }: PdfPriceColumnPillProps) => {
  const [pos, setPos] = useState<PillPos | null>(null);
  const config = getSupplierPriceColumnConfig(supplierName);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;

    async function detect() {
      if (!config) return;

      if (pdfStoragePath) {
        try {
          let pdfUrl = pdfStoragePath;
          try {
            const resp = await fetch(pdfStoragePath);
            if (resp.ok) {
              const blob = await resp.blob();
              pdfUrl = URL.createObjectURL(blob);
            }
          } catch { /* use raw URL */ }

          const { items, pageWidth, pageHeight } = await extractTextItemsFromPdfPage(pdfUrl, pageNumber);
          if (pdfUrl !== pdfStoragePath) URL.revokeObjectURL(pdfUrl);
          if (cancelled) return;

          // Find the FIRST text item matching any configured pattern
          for (const pattern of config.patterns) {
            for (const item of items) {
              if (pattern.test(item.text)) {
                const cx = ((item.x + item.width / 2) / pageWidth) * 100;
                // Place pill just above the header text
                const ty = Math.max(((item.y - 2) / pageHeight) * 100, 0.3);
                setPos({ xPct: cx, yPct: ty });
                return;
              }
            }
          }
        } catch (err) {
          console.warn("[PdfPriceColumnPill] extraction failed, using fallback:", err);
        }
      }

      // Fallback x from config
      if (!cancelled && config.fallbackX) {
        setPos({ xPct: config.fallbackX * 100, yPct: 1 });
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [supplierName, pdfStoragePath, pageNumber, config]);

  if (!config || !pos) return null;

  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        left: `${pos.xPct}%`,
        top: `${pos.yPct}%`,
        transform: "translateX(-50%)",
      }}
    >
      <div
        className="flex items-center justify-center h-5 px-2.5 rounded-full text-[9px] font-bold whitespace-nowrap shadow-sm border"
        style={{
          background: "hsl(var(--success) / 0.15)",
          borderColor: "hsl(var(--success) / 0.5)",
          color: "hsl(var(--success))",
          minWidth: "72px",
          letterSpacing: "0.02em",
        }}
      >
        {config.label}
      </div>
    </div>
  );
});

PdfPriceColumnPill.displayName = "PdfPriceColumnPill";

export default PdfPriceColumnPill;
