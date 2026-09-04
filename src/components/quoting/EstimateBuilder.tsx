/**
 * EstimateBuilder — the single quote surface on /admin/estimates/:id.
 *
 * The estimate document IS the editor: areas are section headers, lines are
 * editable in place, and everything writes into the already-open quoteId via
 * QuoteContext (quote_items / quote_areas). Cost, markup and profit live in a
 * separate staff card outside the pdf capture root.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuoteContext } from "@/contexts/QuoteContext";
import EstimateDocument, { type EstimateEditArea } from "@/components/quoting/EstimateDocument";
import QuoteQuickEditor from "@/components/quoting/QuoteQuickEditor";
import StaffMarginCard from "@/components/quoting/StaffMarginCard";

interface Props {
  quoteNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  vatRate: number;
  notes?: string | null;
  termsText?: string | null;
  onChanged?: () => void;
}

/** Header shown for the default catch-all section (named areas keep their name). */
const DEFAULT_SECTION_LABEL = "Add items to quote";

const discountAmountFor = (subtotal: number, type: string | null, value: number) => {
  if (type === "percentage" || type === "percent") return (subtotal * value) / 100;
  if (type === "fixed") return value;
  return 0;
};


export default function EstimateBuilder({
  quoteNumber,
  issueDate,
  validUntil,
  customerName,
  customerCompany,
  customerAddress,
  customerEmail,
  customerPhone,
  vatRate,
  notes,
  termsText,
  onChanged,
}: Props) {
  const {
    quoteId, meta, areas, items,
    addArea, updateArea, updateItem, deleteItem, updateQuote,
  } = useQuoteContext();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);


  const topLevel = useMemo(() => items.filter((i) => !i.parent_item_id), [items]);

  // Catalog product images for the sales-card thumb on each line.
  const productIds = useMemo(
    () => [...new Set(topLevel.map((i) => i.product_id).filter(Boolean))] as string[],
    [topLevel],
  );
  const { data: productImages = {} } = useQuery({
    queryKey: ["quote-item-product-images", productIds.sort().join(",")],
    enabled: productIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, image_url")
        .in("id", productIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((p: any) => [p.id, p.image_url as string | null]));
    },
  });

  const lineFor = (i: (typeof topLevel)[number]) => ({
    id: i.id,
    name: i.item_name,
    description: i.description,
    quantity: Number(i.quantity || 0),
    unit_price: Number(i.unit_price || 0),
    imageUrl: i.product_id ? (productImages as Record<string, string | null>)[i.product_id] ?? null : null,
  });

  const editAreas: EstimateEditArea[] = useMemo(() => {
    const grouped: EstimateEditArea[] = areas.map((a) => ({
      id: a.id,
      name: a.name,
      lines: topLevel
        .filter((i) => i.area_id === a.id)
        .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
        .map(lineFor),
    }));
    const orphans = topLevel.filter((i) => !i.area_id);
    if (orphans.length > 0) {
      grouped.push({
        id: null,
        name: DEFAULT_SECTION_LABEL,
        lines: orphans.map(lineFor),
      });
    }
    if (grouped.length === 0) grouped.push({ id: null, name: DEFAULT_SECTION_LABEL, lines: [] });
    return grouped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, topLevel, productImages]);


  const subtotal = useMemo(
    () => topLevel.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    [topLevel],
  );
  const discountType = meta?.discount_type ?? null;
  const discountValue = Number(meta?.discount_value ?? 0);
  const discount = discountAmountFor(subtotal, discountType, discountValue);
  const taxAmount = Math.round((subtotal - discount) * vatRate * 100) / 100;
  const total = Math.round((subtotal - discount) * (1 + vatRate) * 100) / 100;

  /** The DB trigger only recalcs on line changes, so push totals when the discount moves. */
  const applyDiscount = async (type: string | null, value: number) => {
    await updateQuote({ discount_type: type, discount_value: value } as any);
    const d = discountAmountFor(subtotal, type, value);
    await supabase
      .from("quotes")
      .update({
        subtotal,
        vat_amount: Math.round((subtotal - d) * vatRate * 100) / 100,
        total: Math.round((subtotal - d) * (1 + vatRate) * 100) / 100,
      })
      .eq("id", quoteId);
    onChanged?.();
  };

  const discountControl = (
    <div className="flex items-center gap-2 pt-1">
      <Select
        value={discountType ?? "none"}
        onValueChange={(v) => applyDiscount(v === "none" ? null : v, v === "none" ? 0 : discountValue)}
      >
        <SelectTrigger className="h-8 w-[130px] border-slate-200 bg-white text-[11px] text-slate-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No discount</SelectItem>
          <SelectItem value="percentage">Discount %</SelectItem>
          <SelectItem value="fixed">Discount R</SelectItem>
        </SelectContent>
      </Select>
      {discountType && (
        <Input
          type="number"
          step="0.01"
          min="0"
          key={`${discountType}-${discountValue}`}
          defaultValue={discountValue}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== discountValue) void applyDiscount(discountType, v);
          }}
          className="h-8 w-24 border-slate-200 bg-white text-right text-[11px] text-slate-700"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <EstimateDocument
        estimateNumber={quoteNumber}
        issueDate={issueDate}
        validUntil={validUntil}
        customerName={customerName}
        customerCompany={customerCompany}
        customerAddress={customerAddress}
        customerEmail={customerEmail}
        customerPhone={customerPhone}
        items={[]}
        subtotal={subtotal}
        taxRate={vatRate}
        taxAmount={taxAmount}
        grandTotal={total}
        discountAmount={discount}
        discountLabel={
          discountType === "fixed" ? null : discountType ? `${discountValue}%` : null
        }
        notes={notes}
        termsText={termsText}
        editing={{
          areas: editAreas,
          selectedLineId,
          onSelectLine: setSelectedLineId,
          onLineChange: (id, patch) => {
            void updateItem(id, patch as any);
            onChanged?.();
          },
          onDeleteLine: (id) => {
            void deleteItem(id);
            if (selectedLineId === id) setSelectedLineId(null);
            onChanged?.();
          },
          onRenameArea: (id, name) => {
            void updateArea(id, { name });
            onChanged?.();
          },
          activeAreaId,
          onSelectArea: setActiveAreaId,
          onAddArea: async () => {
            const created = await addArea(`Area ${areas.length + 1}`);
            if (created?.id) setActiveAreaId(created.id);
          },
          renderAddBar: (areaId) => (
            <QuoteQuickEditor
              key={areaId ?? "default"}
              onChanged={onChanged}
              targetAreaId={areaId}
              dropUp
            />
          ),
          discountControl,

        }}
      />

      <StaffMarginCard items={topLevel} selectedId={selectedLineId} />
    </div>
  );
}
