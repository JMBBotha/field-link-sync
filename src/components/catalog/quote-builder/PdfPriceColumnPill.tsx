/**
 * PdfPriceColumnPill — renders a green pill badge at the top of the PDF page
 * highlighting the supplier's target price column (e.g. "Webshop Price" for Daikin).
 *
 * Uses live text extraction to find the header position, with a fallback x-coordinate.
 */

import { useState, useEffect, memo } from "react";
import { getSupplierPriceColumnConfig } from "@/config/supplierPriceColumns";
import { extractTextItemsFromPdfPage } from "./pdfTextExtractor";

interface PdfPriceColumnPillProps {
  supplierName: string;
  pdfStoragePath: string | null;
  pageNumber: number;
}

interface PillPosition {
  xPct: number; // center x as percentage (0–100)
  yPct: number; // y position as percentage
  label: string;
}

const PdfPriceColumnPill = memo(({ supplierName, pdfStoragePath, pageNumber }: PdfPriceColumnPillProps) => {
  const [pill, setPill] = useState<PillPosition | null>(null);

  const config = getSupplierPriceColumnConfig(supplierName);

  useEffect(() => {
    if (!config) return;

    let cancelled = false;

    async function detect() {
      if (!config) return;

      // Try live text extraction to find the header
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

          // Search for header text matching any pattern
          for (const pattern of config.patterns) {
            for (const item of items) {
              if (pattern.test(item.text)) {
                // Found the header — position pill at its center
                const centerXPct = ((item.x + item.width / 2) / pageWidth) * 100;
                const yPct = (item.y / pageHeight) * 100;
                setPill({ xPct: centerXPct, yPct: Math.max(yPct - 0.5, 0.5), label: config.label });
                return;
              }
            }
          }
        } catch (err) {
          console.warn("[PdfPriceColumnPill] Text extraction failed, using fallback:", err);
        }
      }

      // Fallback: use configured default x position
      if (!cancelled && config.fallbackX) {
        setPill({ xPct: config.fallbackX * 100, yPct: 1.5, label: config.label });
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [supplierName, pdfStoragePath, pageNumber, config]);

  if (!pill) return null;

  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        left: `${pill.xPct}%`,
        top: `${pill.yPct}%`,
        transform: "translateX(-50%)",
      }}
    >
      <div
        className="px-2 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap shadow-sm border pointer-events-auto"
        style={{
          background: "hsl(var(--success) / 0.15)",
          borderColor: "hsl(var(--success) / 0.4)",
          color: "hsl(var(--success))",
        }}
      >
        {pill.label}
      </div>
    </div>
  );
});

PdfPriceColumnPill.displayName = "PdfPriceColumnPill";

export default PdfPriceColumnPill;
