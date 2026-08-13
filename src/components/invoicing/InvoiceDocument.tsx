import logo from "@/assets/logo.png";
import { useCompanySettings } from "@/hooks/useCompanySettings";

export interface InvoiceDocLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface InvoiceDocumentProps {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  items: InvoiceDocLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid?: number;
  notes?: string | null;
}

const formatCurrency = (amount: number) => {
  const n = Number(amount) || 0;
  const safe = Object.is(n, -0) || n === 0 ? 0 : n;
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(safe);
};

/** Normalises a tax rate that may be stored as 0.15 or 15 into a display percentage. */
const toPercent = (rate?: number | null) => {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 15;
  return n <= 1 ? Math.round(n * 10000) / 100 : n;
};

const formatDate = (dateStr?: string | null) =>
  dateStr
    ? new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/**
 * FreshBooks-style tax invoice document.
 * Used both for on-screen viewing and print / PDF capture.
 */
const InvoiceDocument = ({
  invoiceNumber,
  issueDate,
  dueDate,
  customerName,
  customerAddress,
  customerEmail,
  customerPhone,
  items,
  subtotal,
  taxRate,
  taxAmount,
  grandTotal,
  amountPaid = 0,
  notes,
}: InvoiceDocumentProps) => {
  const { settings } = useCompanySettings();
  const bank = settings.banking_details || {};
  const vatPercent = toPercent(taxRate);
  const accountType = String(bank.account_type || "").match(/^[A-Za-z ]+/)?.[0].trim() || bank.account_type || "";
  const amountDue = Math.max(0, (Number(grandTotal) || 0) - (Number(amountPaid) || 0));

  return (
    <div
      data-pdf-capture-root="invoice"
      className="invoice-document mx-auto w-full max-w-[820px] bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0"
    >
      <div className="p-8 sm:p-10">
        {/* ── Top: logo left, business info right ── */}
        <div className="flex items-start justify-between gap-6">
          <div className="rounded-2xl border border-slate-200 bg-[#1B3A5C] p-3 shadow-sm">
            <img src={logo} alt="Company logo" className="h-16 w-auto object-contain" />
          </div>
          <div className="text-right text-[12px] leading-relaxed text-slate-600">
            <p className="text-[15px] font-bold text-[#1B3A5C]">
              {settings.company_name || "0800-BE-COOL AC Super Service"}
            </p>
            {settings.physical_address
              ? settings.physical_address.split("\n").map((line, i) => <p key={i}>{line}</p>)
              : <p>6 Aviation Crescent, Airport City, Cape Town, 7100</p>}
            <p>0800 23 2665</p>
            <p>info@becool.co.za</p>
            {settings.vat_number && <p>VAT No: {settings.vat_number}</p>}
          </div>
        </div>

        {/* ── Meta row: Billed To / Date / Number / Amount Due ── */}
        <div className="mt-8 grid grid-cols-2 gap-6 border-y border-slate-200 py-6 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Billed To</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-900">{customerName}</p>
            {customerAddress && <p className="text-[12px] leading-snug text-slate-600">{customerAddress}</p>}
            {customerEmail && <p className="text-[12px] text-slate-600">{customerEmail}</p>}
            {customerPhone && <p className="text-[12px] text-slate-600">{customerPhone}</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date of Issue</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{formatDate(issueDate)}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{dueDate ? formatDate(dueDate) : "On receipt"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tax Invoice Number</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{invoiceNumber}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount Due (ZAR)</p>
            <p className="mt-1 text-2xl font-bold text-[#1B3A5C]">{formatCurrency(amountDue)}</p>
          </div>
        </div>

        {/* ── Line items ── */}
        <table className="mt-8 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-slate-300 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-b border-slate-100 align-top">
                <td className="py-3 pr-4 text-slate-800">{item.description}</td>
                <td className="py-3 text-right text-slate-600">{formatCurrency(item.unit_price)}</td>
                <td className="py-3 text-right text-slate-600">{item.quantity}</td>
                <td className="py-3 text-right font-medium text-slate-900">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">No line items</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* ── Totals ── */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-[300px] space-y-2 text-[12px]">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>VAT ({vatPercent}%)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Amount Paid</span>
              <span>{(Number(amountPaid) || 0) > 0 ? `-${formatCurrency(amountPaid)}` : formatCurrency(0)}</span>
            </div>
            <div className="flex items-center justify-between border-t-2 border-[#1B3A5C] pt-2 text-[15px] font-bold text-[#1B3A5C]">
              <span>Amount Due (ZAR)</span>
              <span className="text-lg">{formatCurrency(amountDue)}</span>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-10 space-y-5 border-t border-slate-200 pt-6 text-[11px] leading-relaxed text-slate-600">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <p className="mt-1">
              Payment due within {settings.default_payment_terms_days || 30} days of invoice date. All prices
              include VAT at {vatPercent}%. Please use the invoice number as your payment reference.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Banking Details</p>
            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <p><span className="text-slate-400">Account Name: </span>{bank.account_name || settings.company_name || "—"}</p>
              <p><span className="text-slate-400">Bank: </span>{bank.bank_name || "—"}</p>
              <p><span className="text-slate-400">Account: </span>{bank.account_number || "—"}</p>
              <p><span className="text-slate-400">Branch Code: </span>{bank.branch_code || "—"}</p>
              <p><span className="text-slate-400">Type: </span>{accountType || "—"}</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Warranty & Notes</p>
            <p className="mt-1">
              {notes ||
                "All workmanship carries a 12-month warranty. Equipment is covered by the manufacturer's warranty terms. Warranty excludes damage caused by misuse, power surges, or lack of scheduled maintenance."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDocument;
