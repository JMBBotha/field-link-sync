import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { supabase } from "@/integrations/supabase/client";
import type { VisualSection } from "./VisualSectionEditor";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
}

interface BrandedQuotePreviewProps {
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
    reference_text?: string;
    subtotal: number;
    discount_type?: string;
    discount_value?: number;
    vat_rate: number;
    vat_amount: number;
    total: number;
    line_items: LineItem[];
    visual_sections: VisualSection[];
    terms_text?: string;
  } | null;
}

const BrandedQuotePreview = ({ open, onOpenChange, quote }: BrandedQuotePreviewProps) => {
  const { settings } = useCompanySettings();

  if (!quote) return null;

  const logoUrl = settings.logo_storage_path
    ? supabase.storage.from("company-logos").getPublicUrl(settings.logo_storage_path).data.publicUrl
    : null;

  const discountAmount =
    quote.discount_type === "percentage"
      ? quote.subtotal * ((quote.discount_value || 0) / 100)
      : quote.discount_type === "fixed"
      ? quote.discount_value || 0
      : 0;

  const afterDiscount = quote.subtotal - discountAmount;
  const vatOnDiscounted = afterDiscount * quote.vat_rate;
  const grandTotal = afterDiscount + vatOnDiscounted;

  const defaultTerms = `1. This quotation is valid for 30 days from the date of issue.
2. A 50% deposit is required upon acceptance to commence work.
3. Balance due upon completion of work.
4. All prices include 15% VAT as per South African law.
5. Warranty: 12 months on parts, 90 days on labour.
6. Payment terms: EFT, cash, or card on site.`;

  const terms = quote.terms_text || defaultTerms;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto p-0 gap-0">
        {/* ── Branded Header ── */}
        <div className="bg-primary text-primary-foreground p-8">
          <div className="flex items-start justify-between">
            <div>
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-16 mb-3 object-contain" />
              ) : (
                <h1 className="text-2xl font-bold mb-1">{settings.company_name || "BE COOL AC SUPER SERVICE"}</h1>
              )}
              <p className="text-sm opacity-80">0800-BE-COOL (0800 23 2665)</p>
              {settings.vat_number && <p className="text-xs opacity-70">VAT No: {settings.vat_number}</p>}
              {settings.physical_address && <p className="text-xs opacity-70">{settings.physical_address}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-2xl font-bold tracking-wide">QUOTATION</h2>
              <p className="font-mono text-sm mt-1">{quote.quote_number}</p>
              <p className="text-xs opacity-80 mt-1">
                Date: {formatDate(new Date().toISOString())}
              </p>
              {quote.valid_until && (
                <p className="text-xs opacity-80">Valid Until: {formatDate(quote.valid_until)}</p>
              )}
              {quote.reference_text && (
                <p className="text-xs opacity-80 mt-1">Ref: {quote.reference_text}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Client Info ── */}
        <div className="px-8 py-5 border-b">
          <p className="text-xs uppercase text-muted-foreground font-semibold tracking-wider mb-2">
            Prepared For
          </p>
          <p className="font-bold text-lg">{quote.customer_name || "—"}</p>
          {quote.customer_address && <p className="text-sm text-muted-foreground">{quote.customer_address}</p>}
          <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
            {quote.customer_phone && <span>{quote.customer_phone}</span>}
            {quote.customer_email && <span>{quote.customer_email}</span>}
          </div>
        </div>

        {/* ── Pricing Table ── */}
        <div className="px-8 py-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary/10">
                <th className="text-left py-2.5 px-3 font-semibold rounded-tl-md">Description</th>
                <th className="text-center py-2.5 px-3 font-semibold w-16">Qty</th>
                <th className="text-right py-2.5 px-3 font-semibold w-28">Rate</th>
                <th className="text-right py-2.5 px-3 font-semibold w-28 rounded-tr-md">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.line_items.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                  <td className="py-2.5 px-3">{item.description}</td>
                  <td className="py-2.5 px-3 text-center">{item.quantity}</td>
                  <td className="py-2.5 px-3 text-right">{formatZAR(item.unit_price)}</td>
                  <td className="py-2.5 px-3 text-right font-medium">
                    {formatZAR(item.quantity * item.unit_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mt-4">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatZAR(quote.subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-success">
                  <span>
                    Discount
                    {quote.discount_type === "percentage" && ` (${quote.discount_value}%)`}
                  </span>
                  <span>-{formatZAR(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT ({(quote.vat_rate * 100).toFixed(0)}%)</span>
                <span>{formatZAR(vatOnDiscounted)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg pt-1">
                <span>Total (incl. VAT)</span>
                <span className="text-primary">{formatZAR(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Visual Content Sections ── */}
        {quote.visual_sections?.length > 0 && (
          <div className="border-t">
            {quote.visual_sections.map((section, idx) => (
              <div key={idx} className={`px-8 py-6 ${idx % 2 === 1 ? "bg-muted/20" : ""}`}>
                {section.heading && (
                  <h3 className="text-xl font-bold mb-3 text-primary">{section.heading}</h3>
                )}

                {/* Images */}
                {section.images?.length > 0 && (
                  <div className={`mb-4 ${section.images.length === 1 ? "" : "grid grid-cols-2 gap-3"}`}>
                    {section.images.map((url, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={url}
                        alt={section.heading || `Image ${imgIdx + 1}`}
                        className="rounded-lg w-full object-cover max-h-64"
                      />
                    ))}
                  </div>
                )}

                {/* Description */}
                {section.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap mb-3">
                    {section.description}
                  </p>
                )}

                {/* Features */}
                {section.features?.filter(Boolean).length > 0 && (
                  <ul className="space-y-1.5 mt-3">
                    {section.features.filter(Boolean).map((feat, fi) => (
                      <li key={fi} className="flex items-start gap-2 text-sm">
                        <span className="text-primary mt-0.5">✓</span>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Notes ── */}
        {quote.notes && (
          <div className="px-8 py-4 border-t bg-muted/10">
            <p className="text-xs uppercase text-muted-foreground font-semibold mb-1">Notes</p>
            <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* ── Terms ── */}
        <div className="px-8 py-5 border-t bg-muted/30">
          <p className="text-xs uppercase text-muted-foreground font-semibold mb-2">
            Terms & Conditions
          </p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {terms}
          </p>
        </div>

        {/* ── Footer ── */}
        <div className="bg-primary/5 px-8 py-4 text-center text-xs text-muted-foreground border-t">
          <p className="font-semibold">{settings.company_name || "Be Cool AC Super Service (Pty) Ltd"}</p>
          <p>📞 0800-BE-COOL • 📧 info@becool.co.za</p>
          {settings.vat_number && <p className="mt-0.5">VAT Reg: {settings.vat_number}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BrandedQuotePreview;
