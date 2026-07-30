import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Search,
  ImageIcon,
} from "lucide-react";
import {
  ProposalSection,
  ProposalLineItem,
  formatZAR,
  sectionSubtotal,
  newId,
} from "@/types/visualProposal";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";

const TYPE_LABEL: Record<string, string> = {
  cover: "Cover / Title",
  text: "Text",
  image: "Image",
  pricing: "Pricing & line items",
  signature: "Signature",
};

interface Props {
  section: ProposalSection;
  index: number;
  total: number;
  onChange: (patch: Partial<ProposalSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

const ProposalSectionEditor = ({ section, index, total, onChange, onMove, onDelete }: Props) => {
  const [productQuery, setProductQuery] = useState("");
  const { products } = useProductPicker(section.type === "pricing");

  const matches =
    productQuery.trim().length < 2
      ? []
      : (products as any[])
          .filter((p) =>
            `${p.short_name || ""} ${p.product_code || ""} ${p.brand || ""}`
              .toLowerCase()
              .includes(productQuery.toLowerCase()),
          )
          .slice(0, 8);

  const items = section.items || [];
  const setItems = (next: ProposalLineItem[]) => onChange({ items: next });

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onChange({ imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {TYPE_LABEL[section.type]}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label="Move section up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              aria-label="Move section down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={onDelete}
              aria-label="Delete section"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {section.type === "cover" && (
          <div className="space-y-2">
            <Input
              placeholder="Headline"
              value={section.title || ""}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <Input
              placeholder="Subheadline"
              value={section.subtitle || ""}
              onChange={(e) => onChange({ subtitle: e.target.value })}
            />
            <ImageField
              value={section.imageUrl || ""}
              onUrl={(v) => onChange({ imageUrl: v })}
              onFile={handleImageFile}
              label="Hero image (optional)"
            />
          </div>
        )}

        {section.type === "text" && (
          <div className="space-y-2">
            <Input
              placeholder="Section heading"
              value={section.title || ""}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <Textarea
              rows={7}
              placeholder={"Write your content…\n\n# Heading\n**bold**  *italic*\n- bullet item"}
              value={section.body || ""}
              onChange={(e) => onChange({ body: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Formatting: <code>#</code> heading, <code>**bold**</code>, <code>*italic*</code>,{" "}
              <code>-</code> bullet list.
            </p>
          </div>
        )}

        {section.type === "image" && (
          <div className="space-y-2">
            <Input
              placeholder="Section heading (optional)"
              value={section.title || ""}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <ImageField
              value={section.imageUrl || ""}
              onUrl={(v) => onChange({ imageUrl: v })}
              onFile={handleImageFile}
              label="Image"
            />
            <Input
              placeholder="Caption (optional)"
              value={section.caption || ""}
              onChange={(e) => onChange({ caption: e.target.value })}
            />
          </div>
        )}

        {section.type === "pricing" && (
          <div className="space-y-3">
            <Input
              placeholder="Section heading"
              value={section.title || ""}
              onChange={(e) => onChange({ title: e.target.value })}
            />

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search catalog items to add…"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
              />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {matches.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setItems([
                          ...items,
                          {
                            id: newId(),
                            description: p.short_name || p.product_code || "Item",
                            quantity: 1,
                            rate: Number(p.selling_price ?? p.cost_incl_vat ?? p.cost_price ?? 0),
                          },
                        ]);
                        setProductQuery("");
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
            </div>

            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={item.id} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-[160px] flex-1"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...item, description: e.target.value };
                      setItems(next);
                    }}
                  />
                  <Input
                    type="number"
                    className="w-20"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...item, quantity: Number(e.target.value) || 0 };
                      setItems(next);
                    }}
                  />
                  <Input
                    type="number"
                    className="w-28"
                    placeholder="Rate"
                    value={item.rate}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...item, rate: Number(e.target.value) || 0 };
                      setItems(next);
                    }}
                  />
                  <span className="w-28 text-right text-sm font-semibold">
                    {formatZAR(item.quantity * item.rate)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => setItems(items.filter((x) => x.id !== item.id))}
                    aria-label="Remove line item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems([...items, { id: newId(), description: "", quantity: 1, rate: 0 }])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
              <p className="text-sm">
                Subtotal <strong>{formatZAR(sectionSubtotal(section))}</strong>
              </p>
            </div>
          </div>
        )}

        {section.type === "signature" && (
          <div className="space-y-2">
            <Input
              placeholder="Section heading"
              value={section.title || ""}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              The client sees an “Accept &amp; Sign” button here. Acceptance is recorded with a
              timestamp.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/** Lazily fetch catalog products only when a pricing block is rendered. */
const useProductPicker = (enabled: boolean) => {
  const { products } = useQuoteBuilderProducts();
  return { products: enabled ? products : [] };
};

const ImageField = ({
  value,
  onUrl,
  onFile,
  label,
}: {
  value: string;
  onUrl: (v: string) => void;
  onFile: (f: File) => void;
  label: string;
}) => (
  <div className="space-y-1">
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="min-w-[180px] flex-1"
        placeholder="Image URL"
        value={value.startsWith("data:") ? "" : value}
        onChange={(e) => onUrl(e.target.value)}
      />
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted">
        <ImageIcon className="h-4 w-4" /> Upload
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </label>
      {value && (
        <Button variant="ghost" size="sm" onClick={() => onUrl("")}>
          Clear
        </Button>
      )}
    </div>
  </div>
);

export default ProposalSectionEditor;
