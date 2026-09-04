import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import logo from "@/assets/logo.png";
import { useCompanySettings } from "@/hooks/useCompanySettings";

export interface EstimateDocLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  /** Catalog product image for the sales-card treatment (optional). */
  imageUrl?: string | null;
}

/** One editable line inside an area (staff edit mode only). */
export interface EstimateEditLine {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  imageUrl?: string | null;
}

/** One area section inside the quote body (staff edit mode only). */
export interface EstimateEditArea {
  id: string | null;
  name: string;
  lines: EstimateEditLine[];
}

/**
 * Edit affordances folded INTO the document. When absent the document renders
 * exactly as the read-only client-facing estimate.
 */
export interface EstimateEditing {
  areas: EstimateEditArea[];
  selectedLineId: string | null;
  onSelectLine: (id: string | null) => void;
  onLineChange: (
    id: string,
    patch: { item_name?: string; description?: string | null; quantity?: number; unit_price?: number },
  ) => void;
  onDeleteLine: (id: string) => void;
  onRenameArea: (id: string, name: string) => void;
  onAddArea: () => void;
  /** Area currently being built — its add bar is highlighted. */
  activeAreaId?: string | null;
  onSelectArea?: (id: string | null) => void;
  /** Slim add-item / add-service bar rendered below EACH area's lines. */
  renderAddBar?: (areaId: string | null) => ReactNode;
  /** Discount control rendered in the totals block. */
  discountControl?: ReactNode;
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
  /** Discount applied to the subtotal before VAT (0 = none). */
  discountAmount?: number;
  discountLabel?: string | null;
  editing?: EstimateEditing;
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

/** Borderless inputs so the document still reads like a document while editing. */
const inputBase =
  "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-slate-200 focus:border-[#1B3A5C] focus:bg-white";

/**
 * FreshBooks-style estimate document.
 * Read-only for clients; with `editing` supplied it becomes the in-place
 * builder that sales uses (single surface, no floating editor card).
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
  discountAmount = 0,
  discountLabel,
  editing,
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
      className="estimate-document pdf-page mx-auto w-full bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0"
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
        {editing ? (
          <div className="mt-6 space-y-6">
            {editing.areas.map((area) => (
              <section key={area.id ?? "unassigned"}>
                <div className="flex items-center gap-2 border-b border-slate-300 pb-1">
                  {area.id ? (
                    <input
                      defaultValue={area.name}
                      key={`${area.id}-${area.name}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== area.name) editing.onRenameArea(area.id as string, v);
                      }}
                      className={`${inputBase} text-[13px] font-semibold uppercase tracking-wide text-[#1B3A5C]`}
                    />
                  ) : (
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-[#1B3A5C]">{area.name}</p>
                  )}
                </div>

                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="py-2 text-left font-semibold">Description</th>
                      <th className="w-24 py-2 text-right font-semibold">Rate</th>
                      <th className="w-16 py-2 text-right font-semibold">Qty</th>
                      <th className="w-28 py-2 text-right font-semibold">Line Total</th>
                      <th className="w-8 print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {area.lines.map((line) => {
                      const selected = editing.selectedLineId === line.id;
                      return (
                        <tr
                          key={line.id}
                          onFocus={() => editing.onSelectLine(line.id)}
                          onClick={() => editing.onSelectLine(line.id)}
                          className={`border-b border-slate-100 align-top ${
                            selected ? "bg-sky-50/60 print:bg-transparent" : ""
                          }`}
                        >
                          <td className="py-2 pr-4">
                            <div className="flex items-start gap-2">
                              {line.imageUrl && (
                                <img
                                  src={line.imageUrl}
                                  alt={line.name}
                                  className="mt-0.5 h-10 w-10 shrink-0 rounded border border-slate-200 bg-white object-contain"
                                  loading="lazy"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <input
                                  key={`${line.id}-name`}
                                  defaultValue={line.name}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v && v !== line.name) editing.onLineChange(line.id, { item_name: v });
                                  }}
                                  className={`${inputBase} font-medium text-slate-800`}
                                />
                                <textarea
                                  key={`${line.id}-desc`}
                                  defaultValue={line.description ?? ""}
                                  rows={2}
                                  placeholder="Description (prints on the quote)"
                                  onBlur={(e) => {
                                    const v = e.target.value;
                                    if (v !== (line.description ?? "")) {
                                      editing.onLineChange(line.id, { description: v || null });
                                    }
                                  }}
                                  className={`${inputBase} mt-0.5 resize-y text-[11px] text-slate-500`}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2 text-right">
                            <input
                              key={`${line.id}-price`}
                              type="number"
                              step="0.01"
                              defaultValue={line.unit_price}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== line.unit_price) {
                                  editing.onLineChange(line.id, { unit_price: v });
                                }
                              }}
                              className={`${inputBase} text-right text-slate-600`}
                            />
                          </td>
                          <td className="py-2 text-right">
                            <input
                              key={`${line.id}-qty`}
                              type="number"
                              step="1"
                              min="0"
                              defaultValue={line.quantity}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== line.quantity) {
                                  editing.onLineChange(line.id, { quantity: v });
                                }
                              }}
                              className={`${inputBase} text-right text-slate-600`}
                            />
                          </td>
                          <td className="py-2 text-right font-medium text-slate-900">
                            {formatCurrency(line.quantity * line.unit_price)}
                          </td>
                          <td className="py-2 text-right print:hidden">
                            <button
                              type="button"
                              aria-label="Remove line"
                              onClick={() => editing.onDeleteLine(line.id)}
                              className="text-slate-300 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {area.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-[11px] text-slate-400">
                          No lines in this area yet — use the add bar below.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            ))}

            <button
              type="button"
              onClick={editing.onAddArea}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-[12px] text-slate-500 hover:border-[#1B3A5C] hover:text-[#1B3A5C] print:hidden"
            >
              <Plus className="h-3.5 w-3.5" /> Add area
            </button>

            {/* ── Add bar (staff only, never printed) — sits under the lines ── */}
            {editing.searchBar && <div className="pt-1">{editing.searchBar}</div>}
          </div>
        ) : (
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
              {items.map((item, idx) => {
                const [name, ...detailLines] = item.description.split("\n");
                return (
                  <tr key={idx} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-4 text-slate-800">
                      <div className="flex items-start gap-3">
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt={name}
                            className="h-12 w-12 shrink-0 rounded border border-slate-200 bg-white object-contain"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium">{name}</p>
                          {detailLines.map((line, li) => (
                            <p key={li} className="mt-0.5 text-[11px] text-slate-500">{line}</p>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-right text-slate-600">{formatCurrency(item.unit_price)}</td>
                    <td className="py-3 text-right text-slate-600">{item.quantity}</td>
                    <td className="py-3 text-right font-medium text-slate-900">{formatCurrency(item.amount)}</td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">No line items</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* ── Totals ── */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-[320px] space-y-2 text-[12px]">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Discount{discountLabel ? ` (${discountLabel})` : ""}</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {editing?.discountControl && <div className="print:hidden">{editing.discountControl}</div>}
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
