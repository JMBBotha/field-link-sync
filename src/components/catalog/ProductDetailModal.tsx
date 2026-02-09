import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus, Cpu, Wind, Ruler } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface ProductDetailModalProps {
  product: {
    id: string;
    product_code: string;
    description: string;
    category: string;
    supplier_name: string;
    pipe_size: string | null;
    cost_price: number;
    selling_price: number;
    default_markup_percent: number;
    is_price_on_request: boolean;
    btu_rating: number | null;
    refrigerant_type: string | null;
    quote_usage_count: number;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const ProductDetailModal = ({ product, open, onOpenChange, onAddToQuote }: ProductDetailModalProps) => {
  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{product.product_code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">{product.description}</p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{product.category}</Badge>
            <Badge variant="secondary">{product.supplier_name}</Badge>
            {product.refrigerant_type && (
              <Badge variant="outline" className="gap-1">
                <Wind className="h-3 w-3" /> {product.refrigerant_type}
              </Badge>
            )}
            {product.btu_rating && (
              <Badge variant="outline" className="gap-1">
                <Cpu className="h-3 w-3" /> {(product.btu_rating / 1000).toFixed(0)}K BTU
              </Badge>
            )}
            {product.pipe_size && (
              <Badge variant="outline" className="gap-1">
                <Ruler className="h-3 w-3" /> {product.pipe_size}
              </Badge>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Cost Price</p>
              <p className="font-medium">
                {product.is_price_on_request ? "Price on Request" : formatZAR(product.cost_price)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Sell Price ({product.default_markup_percent}% markup)</p>
              <p className="font-bold text-primary">
                {product.is_price_on_request ? "POR" : formatZAR(product.selling_price)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Times Quoted</p>
              <p className="font-medium">{product.quote_usage_count}</p>
            </div>
          </div>

          {onAddToQuote && !product.is_price_on_request && (
            <>
              <Separator />
              <Button
                className="w-full"
                onClick={() => {
                  onAddToQuote({
                    description: `${product.product_code} - ${product.description}`,
                    quantity: 1,
                    unit_price: product.selling_price,
                  });
                  onOpenChange(false);
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Add to Quote
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductDetailModal;
