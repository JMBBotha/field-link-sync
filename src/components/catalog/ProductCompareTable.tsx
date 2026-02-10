import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface Product {
  id: string;
  product_code: string;
  description: string;
  category: string;
  supplier_name: string;
  pipe_size: string | null;
  cost_price: number;
  selling_price: number;
  is_price_on_request: boolean;
  btu_rating: number | null;
  refrigerant_type: string | null;
  short_name?: string | null;
}

interface Props {
  products: Product[];
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  deriveBrand: (p: Product) => string;
  deriveSpeedType: (p: Product) => string;
  derivePhase: (p: Product) => string;
}

interface RowDef {
  label: string;
  getValue: (p: Product) => string;
}

const ProductCompareTable = ({ products, open, onClose, onClear, deriveBrand, deriveSpeedType, derivePhase }: Props) => {
  if (products.length === 0) return null;

  const rows: RowDef[] = [
    { label: "Model Code", getValue: (p) => p.product_code },
    { label: "Short Name", getValue: (p) => p.short_name || "—" },
    { label: "Description", getValue: (p) => p.description },
    { label: "BTU Rating", getValue: (p) => p.btu_rating ? `${(p.btu_rating / 1000).toFixed(0)}K` : "—" },
    { label: "Refrigerant", getValue: (p) => p.refrigerant_type || "—" },
    { label: "Speed Type", getValue: (p) => deriveSpeedType(p) || "—" },
    { label: "Phase", getValue: (p) => derivePhase(p) || "—" },
    { label: "Pipe Size", getValue: (p) => p.pipe_size || "—" },
    { label: "Brand", getValue: (p) => deriveBrand(p) },
    { label: "Cost Price", getValue: (p) => p.is_price_on_request ? "POR" : formatZAR(p.cost_price) },
    { label: "Selling Price", getValue: (p) => p.is_price_on_request ? "POR" : formatZAR(p.selling_price) },
    { label: "Margin", getValue: (p) => p.is_price_on_request ? "—" : formatZAR(p.selling_price - p.cost_price) },
  ];

  const valuesAllSame = (row: RowDef) => {
    const vals = products.map(p => row.getValue(p));
    return vals.every(v => v === vals[0]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto p-0">
        <div className="sticky top-0 z-10 bg-card border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Compare Products</h2>
            <Badge variant="secondary" className="text-xs">{products.length} products</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { onClear(); onClose(); }}>
              Clear Selection
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="p-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left p-2.5 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground w-36 sticky left-0 bg-card">
                  Spec
                </th>
                {products.map((p) => (
                  <th key={p.id} className="text-left p-2.5 border-b min-w-[180px]">
                    <p className="font-mono text-xs">{p.product_code}</p>
                    {p.short_name && <p className="text-primary text-xs font-semibold">{p.short_name}</p>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const differs = !valuesAllSame(row);
                return (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="p-2.5 text-xs font-medium text-muted-foreground sticky left-0 bg-card">
                      {row.label}
                    </td>
                    {products.map((p) => (
                      <td
                        key={p.id}
                        className={`p-2.5 text-xs ${differs ? "bg-amber-500/10" : ""}`}
                      >
                        {row.getValue(p)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductCompareTable;
