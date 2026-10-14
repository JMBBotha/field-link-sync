import BrandDocument, { NotesBody } from "@/components/documents/BrandDocument";
import { foldFlatLines } from "@/lib/clientQuoteRollup";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { cleanBanking } from "@/lib/companyIdentity";
import { formatRand } from "@/utils/formatRand";
import { profileBanking, depositDue, type CompanyProfile } from "@/lib/companyProfiles";

export interface InvoiceDocLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  /** Short line name (bold); description shows underneath. */
  line_name?: string | null;
  room_label?: string | null;
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
  /** Issued credit notes (accounting step 2). */
  credited?: number;
  notes?: string | null;
  /** Issuing company (name, VAT, address, banking). Omit = today's fixed block + primary settings banking. */
  profile?: Partial<CompanyProfile> | null;
  /** Client's VAT number, printed under Billed To. */
  billedToVat?: string | null;
  discountAmount?: number;
  /** Requested deposit in rand (already worked out on the VAT-inclusive total). */
  depositAmount?: number | null;
  depositLabel?: string | null;
}

const formatCurrency = (amount: number) => {
  const n = Number(amount) || 0;
  const safe = Object.is(n, -0) || n === 0 ? 0 : n;
  return formatRand(safe);
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
  credited = 0,
  notes,
  profile,
  billedToVat,
  discountAmount = 0,
  depositAmount,
  depositLabel,
}: InvoiceDocumentProps) => {
  const { settings } = useCompanySettings();
  const bank = profileBanking(profile) || cleanBanking(settings.banking_details);
  const deposit = Number(depositAmount) || 0;
  const depositOutstanding = depositDue(deposit, (Number(amountPaid) || 0) + (Number(credited) || 0));
  const vatPercent = toPercent(taxRate);
  const accountType = bank.account_type;
  const amountDue = Math.max(0, (Number(grandTotal) || 0) - (Number(amountPaid) || 0) - (Number(credited) || 0));

  // Light/Bold tax invoice (Johan 2026-10-13): labour folded into the lines by price, company from its own record.
  const folded = foldFlatLines(items.map((it) => {
    const descLines = (it.description || "").split("\n");
    const [name, ...detail] = it.line_name && it.line_name.trim()
      ? [it.line_name.trim(), ...descLines.filter((l) => l.trim() && l.trim() !== it.line_name!.trim())]
      : descLines;
    return { name: name || "Item", description: detail.filter((l) => l.trim()).join("\n") || null, quantity: Number(it.quantity) || 0, unit_price: Number(it.unit_price) || 0, amount: Number(it.amount) || 0, room: it.room_label || null };
  }));
  const rooms: string[] = [];
  folded.forEach((l) => { const r = l.room || ""; if (!rooms.includes(r)) rooms.push(r); });
  const qty = (n: number) => String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);
  const sections = rooms.map((room) => {
    const ls = folded.filter((l) => (l.room || "") === room);
    return {
      key: room || "all",
      title: room || null,
      subtotal: ls.reduce((s2, l) => s2 + Math.round(l.amount * 100), 0) / 100,
      lines: ls.map((l, j) => ({ key: `${room}-${j}`, quantity: qty(l.quantity), name: l.name, description: l.description, rate: l.unit_price, total: l.amount })),
    };
  });
  const bankLine = [bank.account_name, bank.bank_name, accountType && `${accountType} account`, bank.account_number, bank.branch_code && `Branch ${bank.branch_code}`].filter(Boolean).join(" · ");
  const paid = Number(amountPaid) || 0;
  const cred = Number(credited) || 0;
  return (
    <BrandDocument
      docType="invoice"
      captureRoot="invoice"
      closingPage
      className="invoice-document max-w-[820px]"
      title="TAX INVOICE"
      number={invoiceNumber}
      profile={profile}
      partyLabel="Bill to"
      partyName={customerName}
      partyLines={[customerAddress, customerEmail, customerPhone]}
      partyVat={billedToVat}
      meta={[["Invoice No", invoiceNumber], ["Date", formatDate(issueDate)], ["Due", dueDate ? formatDate(dueDate) : "On receipt"]]}
      sections={sections}
      totals={[
        { label: "Subtotal excl VAT", value: subtotal },
        ...((Number(discountAmount) || 0) > 0 ? [{ label: "Discount", value: Number(discountAmount), negative: true }] : []),
        { label: `VAT ${vatPercent}%`, value: taxAmount },
        { label: "Total incl VAT", value: grandTotal },
        ...(paid > 0 ? [{ label: "Amount paid", value: paid, negative: true }] : []),
        ...(cred > 0 ? [{ label: "Credit notes", value: cred, negative: true }] : []),
      ]}
      grandLabel="Amount due (ZAR)"
      grandTotal={amountDue}
      afterTotals={deposit > 0 ? (
        <div data-testid="deposit-box" style={{ margin: "10px 0 0 auto", maxWidth: 300, border: "1px solid #F7941D", background: "#fff7ed", padding: 8, borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Deposit requested{depositLabel ? ` (${depositLabel})` : ""}</span><span>{formatCurrency(deposit)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#0B4FA8" }}><span>Deposit due</span><span>{formatCurrency(depositOutstanding)}</span></div>
        </div>
      ) : undefined}
      cards={[
        { title: "Payment", body: <p>Payment due within {settings.default_payment_terms_days || 30} days of invoice date. Please use the invoice number as your payment reference.</p> },
        { title: "Banking", body: <p>{bankLine || "—"}</p> },
        { title: "Warranty & notes", body: <NotesBody text={notes || "All workmanship carries a 12-month warranty. Equipment is covered by the manufacturer's warranty terms. Warranty excludes damage caused by misuse, power surges, or lack of scheduled maintenance."} /> },
      ]}
    />
  );
};

export default InvoiceDocument;
