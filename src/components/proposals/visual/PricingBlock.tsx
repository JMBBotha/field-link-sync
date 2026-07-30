import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  ProposalSection,
  ProposalLineItem,
  formatZAR,
  newId,
  sectionSubtotal,
  sectionVat,
} from "@/types/visualProposal";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";

interface Props {
  section: ProposalSection;
  onChange: (patch: Partial<ProposalSection>) => void;
  themeColor: string;
}

const PricingBlock = ({ section, onChange, themeColor }: Props) => {
  const items = section.items || [];
  const setItems = (next: ProposalLineItem[]) => onChange({ items: next });
  const { products } = useQuoteBuilderProducts();
  const [activeSuggest, setActiveSuggest] = useState<string | null>(null);
  const [showDiscount, setShowDiscount] = useState((section.discount || 0) > 0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const patchItem = (i: number, patch: Partial<ProposalLineItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  };

  const suggestions = (q: string) =>
    q.trim().length < 2
      ? []
      : (products as any[])
          .filter((p) =>
            `${p.short_name || ""} ${p.product_code || ""} ${p.brand || ""}`
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
          .slice(0, 6);

  const sub = sectionSubtotal(section);
  const discount = Number(section.discount) || 0;
  const vat = sectionVat(section);
  const total = sub - discount + vat;

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
  };

  return (
    <div className="space-y-3">
      <Input
        className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        placeholder="Pricing"
        value={section.title || ""}
        onChange={(e) => onChange({ title: e.target.value })}
        style={{ color: themeColor }}
      />

      <div className="hidden gap-2 px-7 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_120px_80px_110px_36px]">
        <span>Description</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Line Total</span>
        <span />
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const matches = activeSuggest === item.id ? suggestions(item.description) : [];
          return (
            <div
              key={item.id}
              className="rounded-md border p-2"
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) reorder(dragIndex, i);
                setDragIndex(null);
              }}
            >
              <div className="grid items-start gap-2 sm:grid-cols-[20px_1fr_120px_80px_110px_36px]">
                <GripVertical className="mt-2.5 h-4 w-4 cursor-grab text-muted-foreground" />
                <div className="relative space-y-1">
                  <Input
                    placeholder="Item or service name"
                    value={item.description}
                    onFocus={() => setActiveSuggest(item.id)}
                    onBlur={() => setTimeout(() => setActiveSuggest(null), 150)}
                    onChange={(e) => patchItem(i, { description: e.target.value })}
                  />
                  {matches.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
                      {matches.map((p: any) => (
                        <button
                          key={p.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            patchItem(i, {
                              description: p.short_name || p.product_code || "Item",
                              rate: Number(
                                p.selling_price ?? p.cost_incl_vat ?? p.cost_price ?? 0,
                              ),
                            });
                            setActiveSuggest(null);
                          }}
                        >
                          <span className="truncate">{p.short_name || p.product_code}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatZAR(Number(p.selling_price ?? p.cost_price ?? 0))}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <Textarea
                    rows={2}
                    className="text-xs"
                    placeholder="Additional description (optional)"
                    value={item.detail || ""}
                    onChange={(e) => patchItem(i, { detail: e.target.value })}
                  />
                </div>
                <Input
                  type="number"
                  className="text-right"
                  value={item.rate}
                  onChange={(e) => patchItem(i, { rate: Number(e.target.value) || 0 })}
                />
                <Input
                  type="number"
                  className="text-right"
                  value={item.quantity}
                  onChange={(e) => patchItem(i, { quantity: Number(e.target.value) || 0 })}
                />
                <p className="pt-2 text-right text-sm font-semibold">
                  {formatZAR((Number(item.quantity) || 0) * (Number(item.rate) || 0))}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-destructive"
                  aria-label="Remove line"
                  onClick={() => setItems(items.filter((x) => x.id !== item.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <label className="mt-2 flex items-center gap-2 pl-7 text-xs text-muted-foreground">
                <Switch
                  checked={!!item.taxable}
                  onCheckedChange={(v) => patchItem(i, { taxable: v })}
                />
                VAT (15%) on this line
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setItems([
              ...items,
              { id: newId(), description: "", quantity: 1, rate: 0, taxable: true },
            ])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add a Line
        </Button>
        {!showDiscount && (
          <button
            type="button"
            className="text-sm font-medium underline-offset-2 hover:underline"
            style={{ color: themeColor }}
            onClick={() => setShowDiscount(true)}
          >
            Add a Discount
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm">
          <Row label="Subtotal" value={formatZAR(sub)} />
          {showDiscount && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Discount</span>
              <Input
                type="number"
                className="h-8 w-28 text-right"
                value={section.discount || 0}
                onChange={(e) => onChange({ discount: Number(e.target.value) || 0 })}
              />
            </div>
          )}
          <Row label="VAT (15%)" value={formatZAR(vat)} />
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <span>Proposal Total</span>
            <span style={{ color: themeColor }}>{formatZAR(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

export default PricingBlock;
