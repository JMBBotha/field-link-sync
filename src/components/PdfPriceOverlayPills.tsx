/**
 * PdfPriceOverlayPills — renders transparent pill-shaped overlays
 * with coloured borders over the base price column on PDF pages.
 */

import React from "react";
import { formatRand } from "@/utils/formatRand";

export interface PillProduct {
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
  showPills: boolean;
  /** kept for backward compatibility */
  containerWidth?: number;
  /** kept for backward compatibility */
  containerHeight?: number;
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
  showPills,
  priceColumnLabel,
}) => {
  const pageProducts = React.useMemo(
    () => products.filter((p) => p.page_number === pageIndex + 1),
    [products, pageIndex]
  );

  React.useEffect(() => {
    const withPriceBbox = pageProducts.filter((p) => !!p.price_bbox).length;
    const withoutPriceBbox = pageProducts.length - withPriceBbox;
    console.log(
      `[PdfPriceOverlayPills] page=${pageIndex + 1} received=${pageProducts.length} with_price_bbox=${withPriceBbox} without_price_bbox=${withoutPriceBbox}`
    );
  }, [pageIndex, pageProducts]);

  if (!showPills) return null;

  const pageProductsWithPrice = pageProducts.filter((p) => !!p.price_bbox);

  return (
    <>
      {pageProductsWithPrice.map((product) => {
        const pb = product.price_bbox!;
        const centerXPercent = (pb.center_x ?? pb.x + pb.width / 2) * 100;
        const baseYPercent = pb.y * 100;

        const cost = product.cost_excl_vat || product.cost_price || 0;
        const markup = product.default_markup_percent || 20;
        const sellingPrice = Math.round(cost * (1 + markup / 100) * 100) / 100;
        const discountPct =
          product.cost_price > 0
            ? Math.round(((product.cost_price - cost) / product.cost_price) * 10000) / 100
            : 0;

        const pills = [
          { label: formatRand(sellingPrice), border: "hsl(var(--primary))", title: "Sales Price" },
          { label: formatRand(cost), border: "hsl(var(--success))", title: priceColumnLabel || "Cost" },
          { label: `${discountPct.toFixed(1)}%`, border: "hsl(var(--warning))", title: "Discount" },
          { label: `${markup}%`, border: "hsl(var(--accent))", title: "Markup" },
        ];

        return (
          <div key={`pill-${product.id}`}>
            {/* Main pill on base price */}
            <div
              className="absolute pointer-events-none flex items-center justify-center z-20"
              style={{
                top: `${baseYPercent}%`,
                left: `calc(${centerXPercent}% - ${PILL_WIDTH / 2}px)`,
                width: `${PILL_WIDTH}px`,
                height: `${PILL_HEIGHT}px`,
                borderRadius: "9999px",
                border: "2px solid hsl(var(--success))",
                backgroundColor: "transparent",
              }}
            />

            {/* Stacked calculation pills above */}
            {pills.map((pill, i) => (
              <div
                key={`${product.id}-pill-${i}`}
                className="absolute pointer-events-none flex items-center justify-center text-[9px] font-medium z-20"
                title={pill.title}
                style={{
                  top: `calc(${baseYPercent}% - ${(i + 1) * (SMALL_PILL_HEIGHT + PILL_GAP)}px)`,
                  left: `calc(${centerXPercent}% - ${SMALL_PILL_WIDTH / 2}px)`,
                  width: `${SMALL_PILL_WIDTH}px`,
                  height: `${SMALL_PILL_HEIGHT}px`,
                  borderRadius: "9999px",
                  border: `1.5px solid ${pill.border}`,
                  backgroundColor: "transparent",
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
