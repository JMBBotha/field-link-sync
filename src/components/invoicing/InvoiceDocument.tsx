import { siteLineFor } from "@/lib/billTo";
import BrandDocument, { NotesBody } from "@/components/documents/BrandDocument";
import { foldFlatLines } from "@/lib/clientQuoteRollup";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import InvoiceSignOff from "./InvoiceSignOff";
import { cleanBanking } from "@/lib/companyIdentity";
import InvoiceStamps from "@/components/documents/InvoiceStamps";
import type { InvoiceStamp } from "@/lib/invoiceStamps";
import QuoteTermsPage from "@/components/quoting/QuoteTermsPage";
import type { TermsCompanyInfo } from "@/lib/defaultTerms";
import { profileBanking, type CompanyProfile } from "@/lib/companyProfiles";
import { invoiceDepositCallout } from "@/lib/invoiceDepositCallout";
import DepositDueBlock from "@/components/invoicing/DepositDueBlock";

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
  /** House / site reference shown big under the title (estate invoices), e.g. "House 12 · Estate". */
  reference?: string | null;
  /** Invoice status; void/cancelled get a red VOID stamp and title. */
  status?: string | null;
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
  /** Site / job address (only when it differs from the billing address). */
  siteAddress?: string | null;
  customerCompany?: string | null;
  discountAmount?: number;
  /** Stored deposit request in rand (invoices.deposit_amount, incl. VAT). Display only. */
  depositAmount?: number | null;
  depositType?: string | null;
  /** Stored percent or fixed value. The percent is shown; the rand amount is depositAmount. */
  depositValue?: number | null;
  /** @deprecated The block reads depositType and depositValue. Kept so older callers still compile. */
  depositLabel?: string | null;
  /** MAILED / DEPOSIT PAID / PAID IN FULL stamps (from invoiceStamps()). */
  stamps?: InvoiceStamp[];
  /** Company + banking for the full terms. Printed as the quote-style two-column terms block that flows on
   *  under the closing cards (Johan 2 Nov), so the PDF skips its single-column terms pages. */
  termsCompany?: TermsCompanyInfo | null;
}

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
  invoiceNumber, reference, status,
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
  siteAddress,
  customerCompany,
  discountAmount = 0,
  depositAmount,
  depositType,
  depositValue,
  stamps = [],
  termsCompany,
}: InvoiceDocumentProps) => {
  const { settings } = useCompanySettings();
  const bank = profileBanking(profile) || cleanBanking(settings.banking_details);
  const depositCallout = invoiceDepositCallout({
    grandTotal,
    depositAmount,
    depositType,
    depositValue,
    notes,
    amountPaid,
    credited,
    status,
  });
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
  const isVoid = ["void", "cancelled"].includes(String(status || "").toLowerCase());
  const paid = Number(amountPaid) || 0;
  const cred = Number(credited) || 0;
  return (
    <BrandDocument
      docType="invoice"
      captureRoot="invoice"
      closingPage
      className="invoice-document max-w-[820px]"
      title={isVoid ? "TAX INVOICE (VOID)" : "TAX INVOICE"}
      stamp={isVoid ? "VOID" : null}
      stampsRow={isVoid ? null : <InvoiceStamps stamps={stamps} />}
      banner={depositCallout ? <DepositDueBlock model={depositCallout} /> : undefined}
      number={invoiceNumber}
      reference={reference}
      profile={profile}
      partyLabel="Bill to"
      partyName={customerName}
      partyLines={[customerCompany, customerAddress, customerEmail, customerPhone]}
      partyVat={billedToVat}
      partySite={siteLineFor(siteAddress, customerAddress)}
      meta={[...(reference ? [["House / site", reference] as [string, string]] : []), ["Invoice No", invoiceNumber], ["Date", formatDate(issueDate)], ["Due", dueDate ? formatDate(dueDate) : "On receipt"]]}
      sections={sections}
      totals={[
        { label: "Subtotal excl VAT", value: subtotal },
        ...((Number(discountAmount) || 0) > 0 ? [{ label: "Discount", value: Number(discountAmount), negative: true }] : []),
        { label: `VAT ${vatPercent}%`, value: taxAmount },
        { label: "Total incl VAT", value: grandTotal },
        ...(paid > 0 ? [{ label: "Amount paid", value: paid, negative: true }] : []),
        ...(cred > 0 ? [{ label: "Credit notes", value: cred, negative: true }] : []),
      ]}
      grandLabel={isVoid ? "VOID · nothing due (ZAR)" : "Amount due (ZAR)"}
      grandTotal={isVoid ? 0 : amountDue}
      cards={[
        { title: "Payment", body: <p>Payment due within {settings.default_payment_terms_days || 7} days of invoice date. Please use the invoice number as your payment reference.</p> },
        { title: "Banking", body: <p data-testid="invoice-banking" style={{ fontWeight: 700, color: "#1B3A5C" }}>{bankLine || "—"}{bankLine ? <><br />Reference: {invoiceNumber}</> : null}</p> },
        { title: "Warranty & notes", body: <NotesBody text={notes || "All workmanship carries a 12-month warranty. Equipment is covered by the manufacturer's warranty terms. Warranty excludes damage caused by misuse, power surges, or lack of scheduled maintenance."} /> },
      ]}
      fullTermsPage={termsCompany && !termsCompany.customText ? (
        <>
        <QuoteTermsPage
          companyName={termsCompany.companyName || "Our Company"}
          bankName={termsCompany.bankName}
          accountName={termsCompany.accountName}
          accountNumber={termsCompany.accountNumber}
          branchCode={termsCompany.branchCode}
          accountType={termsCompany.accountType}
          quoteNumber={invoiceNumber}
          docLabel="Invoice"
          rowFlow
        />
        <InvoiceSignOff profile={profile} />
        </>
      ) : undefined}
    />
  );
};

export default InvoiceDocument;
