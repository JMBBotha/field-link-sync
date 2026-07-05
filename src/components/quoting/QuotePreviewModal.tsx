import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import QuoteStatusBadge from "./QuoteStatusBadge";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

interface QuotePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: {
    quote_number: string;
    status: string;
    customer_name?: string;
    customer_address?: string;
    customer_phone?: string;
    customer_email?: string;
    valid_until?: string;
    notes?: string;
    subtotal: number;
    vat_rate: number;
    vat_amount: number;
    total: number;
    line_items: LineItem[];
  } | null;
}

const QuotePreviewModal = ({ open, onOpenChange, quote }: QuotePreviewProps) => {
  if (!quote) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Quote Preview</span>
            <QuoteStatusBadge status={quote.status} />
          </DialogTitle>
        </DialogHeader>

        {/* Company Header */}
        <div className="text-center py-4 bg-[#0077B6] text-white rounded-lg">
          <h2 className="text-xl font-bold">AC Super Service</h2>
          <p className="text-sm text-blue-100">0800-BE-COOL</p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mt-4">
          <div>
            <p className="text-muted-foreground text-xs uppercase">Quote To</p>
            <p className="font-medium">{quote.customer_name || "—"}</p>
            <p>{quote.customer_address}</p>
            <p>{quote.customer_phone}</p>
            <p>{quote.customer_email}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs uppercase">Quote</p>
            <p className="font-mono font-bold">{quote.quote_number}</p>
            {quote.valid_until && (
              <p className="text-xs text-muted-foreground mt-1">
                Valid until: {new Date(quote.valid_until).toLocaleDateString("en-ZA")}
              </p>
            )}
          </div>
        </div>

        <Separator className="my-4" />

        {/* Line Items */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium text-center w-16">Qty</th>
              <th className="py-2 font-medium text-right w-28">Unit Price</th>
              <th className="py-2 font-medium text-right w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.line_items.map((item, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-center">{item.quantity}</td>
                <td className="py-2 text-right">{formatZAR(item.unit_price)}</td>
                <td className="py-2 text-right">{formatZAR(item.quantity * item.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex flex-col items-end gap-1 mt-4 text-sm">
          <div className="flex justify-between w-48">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatZAR(quote.subtotal)}</span>
          </div>
          <div className="flex justify-between w-48">
            <span className="text-muted-foreground">VAT ({(quote.vat_rate * 100).toFixed(0)}%)</span>
            <span>{formatZAR(quote.vat_amount)}</span>
          </div>
          <Separator className="w-48 my-1" />
          <div className="flex justify-between w-48 font-bold">
            <span>Total</span>
            <span>{formatZAR(quote.total)}</span>
          </div>
        </div>

        {quote.notes && (
          <div className="mt-4 p-3 bg-white border rounded-md text-sm">
            <p className="text-xs uppercase text-muted-foreground mb-1">Notes</p>
            <p>{quote.notes}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QuotePreviewModal;
