import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface Section {
  section_type: string;
  title: string;
  content: string;
  sort_order: number;
  photos: string[];
}

interface ProposalPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: Section[];
  quote: any;
}

// Simple markdown-to-HTML (headings, bold, lists, tables)
const renderMarkdown = (md: string) => {
  if (!md) return "";
  let html = md
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/^(\|.+\|)$/gm, (match) => {
      const cells = match.split("|").filter(Boolean).map((c) => c.trim());
      return `<tr>${cells.map((c) => `<td class="border px-3 py-1.5 text-sm">${c}</td>`).join("")}</tr>`;
    })
    .replace(/\n/g, "<br />");

  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /(<li[^>]*>.*?<\/li>(<br \/>)?)+/g,
    (match) => `<ul class="list-disc space-y-1 my-2">${match.replace(/<br \/>/g, "")}</ul>`
  );
  // Wrap consecutive <tr> in <table>
  html = html.replace(
    /(<tr>.*?<\/tr>(<br \/>)?)+/g,
    (match) => `<table class="w-full border-collapse border my-4">${match.replace(/<br \/>/g, "")}</table>`
  );

  return html;
};

const sectionBgColors: Record<string, string> = {
  cover: "bg-[#0077B6] text-white",
  pricing: "bg-primary/5",
  terms: "bg-muted/50",
  warranty: "bg-green-50",
  about: "bg-muted/30",
};

const ProposalPreview = ({ open, onOpenChange, sections, quote }: ProposalPreviewProps) => {
  const customer = quote?.customers;
  const lineItems = quote?.quote_line_items || [];

  const categoryColors: Record<string, string> = {
    installation: "border-blue-400 bg-blue-50",
    repair: "border-orange-400 bg-orange-50",
    maintenance: "border-green-400 bg-green-50",
    duct_cleaning: "border-purple-400 bg-purple-50",
    vrv_vrf: "border-cyan-400 bg-cyan-50",
    other: "border-gray-400 bg-gray-50",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto p-0">
        {sections.map((section, index) => {
          const bgClass = sectionBgColors[section.section_type] || (index % 2 === 0 ? "bg-background" : "bg-muted/20");

          // Cover page - special layout
          if (section.section_type === "cover") {
            return (
              <div key={index} className="bg-[#0077B6] text-white p-8 sm:p-12 text-center">
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">AC Super Service</h1>
                <p className="text-blue-200 text-lg mb-6">0800-BE-COOL</p>
                <Separator className="bg-blue-300/30 my-6" />
                <h2 className="text-2xl font-semibold mb-2">{section.title}</h2>
                {customer && (
                  <p className="text-blue-100 text-lg mt-4">
                    Prepared for <strong>{customer.name}</strong>
                  </p>
                )}
                <p className="text-blue-200 text-sm mt-4">
                  {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}
                </p>
                {quote?.quote_number && (
                  <p className="text-blue-200 text-xs mt-2 font-mono">Ref: {quote.quote_number}</p>
                )}
              </div>
            );
          }

          // Pricing section - show cards
          if (section.section_type === "pricing") {
            return (
              <div key={index} className={`p-6 sm:p-8 ${bgClass}`}>
                <h2 className="text-xl font-bold mb-4">{section.title}</h2>
                {section.content && (
                  <div className="text-sm mb-4" dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }} />
                )}
                {lineItems.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 mb-6">
                    {lineItems.map((item: any, i: number) => (
                      <div
                        key={i}
                        className={`rounded-lg border-l-4 p-4 shadow-sm bg-background ${categoryColors["installation"]}`}
                      >
                        <p className="font-semibold text-sm">{item.description}</p>
                        <div className="flex justify-between items-end mt-2">
                          <span className="text-xs text-muted-foreground">Qty: {item.quantity}</span>
                          <span className="text-lg font-bold">
                            {formatZAR(Number(item.quantity) * Number(item.unit_price))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* VAT summary */}
                {quote && (
                  <div className="bg-background rounded-lg p-4 border max-w-xs ml-auto">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatZAR(Number(quote.subtotal))}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">VAT (15%)</span>
                      <span>{formatZAR(Number(quote.vat_amount))}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-bold text-lg">
                      <span>Total</span>
                      <span>{formatZAR(Number(quote.total))}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // Standard section
          return (
            <div key={index} className={`p-6 sm:p-8 ${bgClass}`}>
              <h2 className="text-xl font-bold mb-3">{section.title}</h2>
              {section.content && (
                <div
                  className="prose prose-sm max-w-none text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
                />
              )}
            </div>
          );
        })}

        {/* Footer */}
        <div className="bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          <p className="font-semibold">AC Super Service</p>
          <p>📞 0800-BE-COOL • 📧 info@acsuperservice.co.za</p>
          <p className="text-xs mt-1">This proposal is confidential and intended solely for the named recipient.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProposalPreview;
