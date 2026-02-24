import type { InvoiceTemplateConfig } from "@/pages/admin/AdminInvoiceTemplatesPage";

const sampleData = {
  invoiceNumber: "INV-042",
  date: "10 Feb 2026",
  dueDate: "12 Mar 2026",
  company: { name: "CoolAir Solutions (Pty) Ltd", address: "14 Bree Street, Cape Town, 8001", vat: "VAT: 4120345678", phone: "021 555 1234", email: "info@coolair.co.za" },
  client: { name: "John van der Berg", address: "22 Long Street, Stellenbosch, 7600", phone: "082 444 5555", email: "john@example.com" },
  items: [
    { description: "Midea Xtreme Inverter 12000 BTU Supply & Install", qty: 1, unitPrice: 12500, discount: 0, tax: 1875, total: 14375 },
    { description: "6m Pipe Kit + Bracket", qty: 1, unitPrice: 2800, discount: 0, tax: 420, total: 3220 },
    { description: "Electrical Connection (DB)", qty: 1, unitPrice: 1500, discount: 0, tax: 225, total: 1725 },
  ],
  subtotal: 16800,
  vat: 2520,
  total: 19320,
};

interface Props {
  config: InvoiceTemplateConfig;
}

const InvoiceTemplatePreview = ({ config }: Props) => {
  const visibleCols = Object.entries(config.showColumns).filter(([, v]) => v).map(([k]) => k);

  return (
    <div
      className="bg-white text-black p-6 min-h-[600px] text-[11px] leading-relaxed overflow-auto"
      style={{ fontFamily: config.fontFamily, maxHeight: "80vh", aspectRatio: "210/297" }}
    >
      {/* Header */}
      {config.sections.companyDetails && (
        <div className="flex flex-row items-start justify-between mb-6 gap-6">
          {/* Logo / brand – left */}
          <div className="shrink-0 max-w-[50%]">
            <div className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: config.primaryColor }}>
              CA
            </div>
          </div>
          {/* Company details – right */}
          <div className={`flex flex-col items-end text-right space-y-0.5`}>
            <p className="font-bold text-sm" style={{ color: config.primaryColor }}>{sampleData.company.name}</p>
            <p className="text-gray-500 text-[10px] whitespace-pre-line leading-relaxed">{sampleData.company.address}</p>
            <p className="text-gray-500 text-[10px]">{sampleData.company.vat}</p>
            <p className="font-bold text-lg tracking-wider mt-2" style={{ color: config.primaryColor }}>{config.invoiceTitle}</p>
            <p className="text-gray-500"># {sampleData.invoiceNumber}</p>
          </div>
        </div>
      )}

      {/* Client & Dates */}
      {config.sections.clientInfo && (
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="uppercase text-[9px] font-bold tracking-wider mb-1" style={{ color: config.accentColor }}>Bill To</p>
            <p className="font-semibold">{sampleData.client.name}</p>
            <p className="text-gray-500">{sampleData.client.address}</p>
            <p className="text-gray-500">{sampleData.client.phone}</p>
          </div>
          <div className="text-right">
            <div className="space-y-1">
              <div><span className="text-gray-500">Date: </span><span className="font-medium">{sampleData.date}</span></div>
              <div><span className="text-gray-500">Due: </span><span className="font-medium">{sampleData.dueDate}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Line Items */}
      {config.sections.lineItems && (
        <table className="w-full mb-6">
          <thead>
            <tr style={{ backgroundColor: config.primaryColor }}>
              {visibleCols.includes("description") && <th className="text-left py-2 px-3 text-white text-[10px] font-semibold rounded-tl-md">Description</th>}
              {visibleCols.includes("quantity") && <th className="text-center py-2 px-2 text-white text-[10px] font-semibold w-12">Qty</th>}
              {visibleCols.includes("unitPrice") && <th className="text-right py-2 px-2 text-white text-[10px] font-semibold w-20">Unit Price</th>}
              {visibleCols.includes("discount") && <th className="text-right py-2 px-2 text-white text-[10px] font-semibold w-16">Discount</th>}
              {visibleCols.includes("tax") && <th className="text-right py-2 px-2 text-white text-[10px] font-semibold w-16">Tax</th>}
              {visibleCols.includes("total") && <th className="text-right py-2 px-3 text-white text-[10px] font-semibold rounded-tr-md w-20">Total</th>}
            </tr>
          </thead>
          <tbody>
            {sampleData.items.map((item, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                {visibleCols.includes("description") && <td className="py-2 px-3">{item.description}</td>}
                {visibleCols.includes("quantity") && <td className="py-2 px-2 text-center">{item.qty}</td>}
                {visibleCols.includes("unitPrice") && <td className="py-2 px-2 text-right">R {item.unitPrice.toLocaleString()}</td>}
                {visibleCols.includes("discount") && <td className="py-2 px-2 text-right">R {item.discount.toLocaleString()}</td>}
                {visibleCols.includes("tax") && <td className="py-2 px-2 text-right">R {item.tax.toLocaleString()}</td>}
                {visibleCols.includes("total") && <td className="py-2 px-3 text-right font-medium">R {item.total.toLocaleString()}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Subtotals */}
      {config.sections.subtotals && (
        <div className="flex justify-end mb-6">
          <div className="w-48 space-y-1">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>R {sampleData.subtotal.toLocaleString()}</span></div>
            <div className="flex justify-between text-gray-600"><span>VAT (15%)</span><span>R {sampleData.vat.toLocaleString()}</span></div>
            <div className="border-t border-gray-300 my-1" />
            <div className="flex justify-between font-bold text-sm" style={{ color: config.primaryColor }}>
              <span>Total</span><span>R {sampleData.total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bank Details */}
      {config.sections.bankDetails && config.bankDetailsText && (
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <p className="uppercase text-[9px] font-bold tracking-wider mb-1" style={{ color: config.accentColor }}>Banking Details (EFT)</p>
          <p className="whitespace-pre-line text-gray-600">{config.bankDetailsText}</p>
        </div>
      )}

      {/* Payment Terms */}
      {config.sections.paymentTerms && config.paymentTermsText && (
        <div className="mb-4">
          <p className="uppercase text-[9px] font-bold tracking-wider mb-1" style={{ color: config.accentColor }}>Payment Terms</p>
          <p className="text-gray-600">{config.paymentTermsText}</p>
        </div>
      )}

      {/* Footer */}
      {config.sections.notes && config.footerText && (
        <div className="border-t border-gray-200 pt-3 text-center text-gray-400 text-[10px]">
          {config.footerText}
        </div>
      )}
    </div>
  );
};

export default InvoiceTemplatePreview;
