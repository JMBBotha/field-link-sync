/**
 * PdfPriceColumnPill — renders a green pill badge at the top of the PDF page
 * highlighting the supplier's target price column (e.g. "Webshop Price" for Daikin).
 *
 * Uses live text extraction to find the header position, with a fallback x-coordinate.
 * Caches detected x-position per supplier so all pages align consistently.
 */

import { useState, useEffect, memo } from "react";
import { getSupplierPriceColumnConfig } from "@/config/supplierPriceColumns";
import { extractTextItemsFromPdfPage } from "./pdfTextExtractor";

interface PdfPriceColumnPillProps {
  supplierName: string;
  pdfStoragePath: string | null;
  pageNumber: number;
}

// ─── Cross-page cache: ensures all pages for the same supplier use the same x ───
const supplierXCache = new Map<string, number>();

const PILL_Y_PCT = 0.8; // Fixed y-position near top of every page (percentage)

const PdfPriceColumnPill = memo(({ supplierName, pdfStoragePath, pageNumber }: PdfPriceColumnPillProps) => {
  const [xPct, setXPct] = useState<number | null>(null);

  const config = getSupplierPriceColumnConfig(supplierName);
  const cacheKey = (supplierName || "").toLowerCase().trim();

  useEffect(() => {
    if (!config) return;

    // If we already have a cached x for this supplier, use it immediately
    const cached = supplierXCache.get(cacheKey);
    if (cached !== undefined) {
      setXPct(cached);
      return;
    }

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

          const { items, pageWidth } = await extractTextItemsFromPdfPage(pdfUrl, pageNumber);

          if (pdfUrl !== pdfStoragePath) URL.revokeObjectURL(pdfUrl);
          if (cancelled) return;

          // Search for header text matching any pattern
          for (const pattern of config.patterns) {
            for (const item of items) {
              if (pattern.test(item.text)) {
                const centerX = ((item.x + item.width / 2) / pageWidth) * 100;
                supplierXCache.set(cacheKey, centerX);
                setXPct(centerX);
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
        const fallback = config.fallbackX * 100;
        supplierXCache.set(cacheKey, fallback);
        setXPct(fallback);
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [cacheKey, pdfStoragePath, pageNumber, config]);

  if (!config || xPct === null) return null;

  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        right: "21px",
        top: `${PILL_Y_PCT}%`,
        transform: "translateY(-50%)",
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
