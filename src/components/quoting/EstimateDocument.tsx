import logo from "@/assets/logo.png";
import { useCompanySettings } from "@/hooks/useCompanySettings";

export interface EstimateDocLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface EstimateDocumentProps {
  estimateNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  items: EstimateDocLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  notes?: string | null;
  termsText?: string | null;
}

const formatCurrency = (amount: number) => {
  const n = Number(amount) || 0;
  const safe = Object.is(n, -0) || n === 0 ? 0 : n;
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(safe);
};

/** Normalises a tax rate stored as 0.15 or 15 into a display percentage. */
const toPercent = (rate?: number | null) => {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 15;
  return n <= 1 ? Math.round(n * 10000) / 100 : n;
};

/**
 * Older quotes stored a hard-coded banking-details block inside terms_text.
 * Banking details now come from company settings (single source of truth), so
 * strip any legacy banking block out of the terms copy to avoid showing two
 * conflicting account numbers.
 */
const stripLegacyBanking = (terms?: string | null) => {
  if (!terms) return terms ?? null;
  const cleaned = terms
    .replace(/\n?\s*banking\s*details\s*:?[\s\S]*$/i, "")
    .trimEnd();
  return cleaned.length > 0 ? cleaned : null;
};

const formatDate = (dateStr?: string | null) =>
  dateStr
    ? new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/**
 * FreshBooks-style read-only estimate document.
 * Mirrors InvoiceDocument so estimates and invoices look consistent.
 */
const EstimateDocument = ({
  estimateNumber,
  issueDate,
  validUntil,
  customerName,
  customerCompany,
  customerAddress,
  customerEmail,
  customerPhone,
  items,
  subtotal,
  taxRate,
  taxAmount,
  grandTotal,
  notes,
  termsText,
}: EstimateDocumentProps) => {
  const { settings } = useCompanySettings();
  const bank = settings.banking_details || {};
  const vatPercent = toPercent(taxRate);
  const accountType =
    String(bank.account_type || "").match(/^[A-Za-z ]+/)?.[0].trim() || bank.account_type || "";
  const cleanTerms = stripLegacyBanking(termsText);

  return (
    <div
      data-pdf-capture-root="estimate"
      className="estimate-document mx-auto w-full max-w-[820px] bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0"
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

        {/* ── Title ── */}
        <h1 className="mt-8 text-[22px] font-bold tracking-tight text-[#1B3A5C]">Estimate</h1>

        {/* ── Meta row ── */}
        <div className="mt-4 grid grid-cols-2 gap-6 border-y border-slate-200 py-6 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Prepared For</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-900">{customerName}</p>
            {customerCompany && <p className="text-[12px] text-slate-600">{customerCompany}</p>}
            {customerAddress && <p className="text-[12px] leading-snug text-slate-600">{customerAddress}</p>}
            {customerEmail && <p className="text-[12px] text-slate-600">{customerEmail}</p>}
            {customerPhone && <p className="text-[12px] text-slate-600">{customerPhone}</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{formatDate(issueDate)}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Valid Until</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">
              {validUntil ? formatDate(validUntil) : "30 days"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Estimate Number</p>
            <p className="mt-1 text-[13px] font-medium text-slate-900">{estimateNumber}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total (ZAR)</p>
            <p className="mt-1 text-2xl font-bold text-[#1B3A5C]">{formatCurrency(grandTotal)}</p>
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
            <div className="flex items-center justify-between border-t-2 border-[#1B3A5C] pt-2 text-[15px] font-bold text-[#1B3A5C]">
              <span>Total (ZAR)</span>
              <span className="text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-10 space-y-5 border-t border-slate-200 pt-6 text-[11px] leading-relaxed text-slate-600">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terms</p>
            <p className="mt-1 whitespace-pre-line">
              {cleanTerms ||
                `This estimate is valid for 30 days from the date of issue. All prices exclude VAT, which is shown separately at ${vatPercent}%. A ${settings.default_deposit_percentage || 50}% deposit is payable on acceptance; the balance is due within ${settings.default_payment_terms_days || 30} days of completion.`}
            </p>
          </div>

          {notes && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
              <p className="mt-1 whitespace-pre-line">{notes}</p>
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
};

export default EstimateDocument;
