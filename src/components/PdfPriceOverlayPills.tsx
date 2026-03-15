/**
 * PdfPriceOverlayPills — renders transparent pill-shaped overlays
 * with coloured borders over the base price column on PDF pages.
 * Shows cost breakdown (selling, cost, discount%, markup%) stacked above each price.
 */

import React from "react";
import { formatRand } from "@/utils/formatRand";

interface PillProduct {
  id: string;
  product_code: string;
  cost_price: number;
  cost_excl_vat: number;
  default_markup_percent: number;
  row_bbox: { x: number; y: number; width: number; height: number } | null;
  price_bbox: { x: number; y: number; width: number; height: number; center_x?: number } | null;
  page_number: number | null;
}

interface PdfPriceOverlayPillsProps {
  products: PillProduct[];
  pageIndex: number;
  containerWidth: number;
  containerHeight: number;
  showPills: boolean;
  /** Resolved column name for display in tooltip */
  priceColumnLabel?: string;
}

const PILL_HEIGHT = 20;
const PILL_GAP = 2;
const PILL_WIDTH = 100;
const SMALL_PILL_WIDTH = 88;
const SMALL_PILL_HEIGHT = 16;

const PdfPriceOverlayPills: React.FC<PdfPriceOverlayPillsProps> = ({
  products,
  pageIndex,
  containerWidth,
  containerHeight,
  showPills,
  priceColumnLabel,
}) => {
  if (!showPills || !containerWidth || !containerHeight) return null;

  const pageProducts = products.filter(
    (p) => p.page_number === pageIndex + 1 && p.price_bbox
  );

  return (
    <>
      {pageProducts.map((product) => {
        const pb = product.price_bbox!;
        const centerX = (pb.center_x ?? pb.x + pb.width / 2) * containerWidth;
        const baseY = pb.y * containerHeight;
        const cost = product.cost_excl_vat || product.cost_price || 0;
        const markup = product.default_markup_percent || 20;
        const sellingPrice = Math.round(cost * (1 + markup / 100) * 100) / 100;
        const discountPct =
          product.cost_price > 0
            ? Math.round(((product.cost_price - cost) / product.cost_price) * 10000) / 100
            : 0;

        const pills = [
          { label: formatRand(sellingPrice), border: "hsl(var(--primary))", title: "Sales Price" },
          { label: formatRand(cost), border: "hsl(142 71% 45%)", title: priceColumnLabel || "Cost" },
          { label: `${discountPct.toFixed(1)}%`, border: "hsl(25 95% 53%)", title: "Discount" },
          { label: `${markup}%`, border: "hsl(270 60% 55%)", title: "Markup" },
        ];

        return (
          <div key={`pill-${product.id}`}>
            {/* Main green pill on the price itself */}
            <div
              className="absolute pointer-events-none flex items-center justify-center"
              style={{
                top: `${baseY}px`,
                left: `${centerX - PILL_WIDTH / 2}px`,
                width: `${PILL_WIDTH}px`,
                height: `${PILL_HEIGHT}px`,
                borderRadius: "9999px",
                border: "2px solid hsl(142 71% 45%)",
                backgroundColor: "transparent",
              }}
            />

            {/* Stacked calculation pills above */}
            {pills.map((pill, i) => (
              <div
                key={`${product.id}-pill-${i}`}
                className="absolute pointer-events-none flex items-center justify-center text-[9px] font-medium"
                title={pill.title}
                style={{
                  top: `${baseY - (i + 1) * (SMALL_PILL_HEIGHT + PILL_GAP)}px`,
                  left: `${centerX - SMALL_PILL_WIDTH / 2}px`,
                  width: `${SMALL_PILL_WIDTH}px`,
                  height: `${SMALL_PILL_HEIGHT}px`,
                  borderRadius: "9999px",
                  border: `1.5px solid ${pill.border}`,
                  backgroundColor: "hsla(var(--background) / 0.85)",
                  color: "hsl(var(--foreground))",
                }}
              >
                <span className="truncate px-1">
                  {pill.title}: {pill.label}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
};

export default PdfPriceOverlayPills;
