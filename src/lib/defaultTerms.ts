import { REMOTE_QUOTE_HEADING, remoteQuoteParagraphs } from "./remoteQuoteClause";
import { RELOCATION_HEADING, RELOCATION_CLAUSE_DEFAULT } from "./relocationClause";
/**
 * Structured terms data for formatted PDF rendering.
 * Each block has a type that controls how it renders in the PDF:
 *   - "title": centered, bold, larger font
 *   - "heading": centered, bold section heading
 *   - "paragraph": centered body text
 *   - "bullet": bullet point with optional bold prefix before ":"
 *   - "banking": centered bold key-value line
 *   - "spacer": blank vertical space
 */

export interface TermsBlock {
  type: "title" | "heading" | "paragraph" | "bullet" | "banking" | "spacer";
  text: string;
  /** For bullets — bold text before the colon */
  boldPrefix?: string;
}

/** Company identity + banking data needed to personalise the terms/banking page. */
export interface TermsCompanyInfo {
  /** Trading/company name, e.g. "0800-BE-COOL AC Super Service". Falls back to "Our Company" if blank. */
  companyName?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  branchCode?: string;
  accountType?: string;
  /** A company's own terms text (company_profiles.terms_text, placeholders already filled). Replaces the standard copy. */
  customText?: string;
  /** Footer line on the terms pages (company name · tel · VAT · address). Defaults to the fixed block. */
  footerLine?: string;
  contactLine?: string;
  /** Remote (phone/online) quote: adds section 12 "Quotes made by phone or online". */
  remoteQuote?: boolean;
  /** Quote issued before 2026-10-18 22:00 SAST: keep the old 2.1 payment wording. */
  legacyPayment?: boolean;
  /** Online shop order (paid in full): 2.1 is full payment on order and 12.5 says "refund your payment in full". */
  remotePaidInFull?: boolean;
  /** Quote removes/relocates existing units: adds "Existing / relocated units" (12, or 13 after the phone/online section). */
  relocatedUnits?: boolean;
  /** Company-wide clause wording (company_terms.relocation_clause). Defaults to the approved text. */
  relocationText?: string;
}

/** "Existing / relocated units" section blocks, numbered after the last standard section. */
const relocationBlocks = (company: TermsCompanyInfo, n: number): TermsBlock[] =>
  company.relocatedUnits
    ? [{ type: "heading", text: RELOCATION_HEADING }, { type: "paragraph", text: `${n}.1 ${(company.relocationText || "").trim() || RELOCATION_CLAUSE_DEFAULT}` }, { type: "spacer", text: "" }]
    : [];

const FALLBACK_COMPANY_NAME = "Our Company";
const LEGACY_PAYMENT_21 = "2.1 To provide the best possible price, the cost of the unit/s is to be paid in full as acceptance of our quotation. The remainder of the installation amount is payable upon completion of the project.";
/** Johan 2026-10-18 22:08. */
export const PAYMENT_21 = "2.1 For supply-and-install jobs, a 70% deposit is payable on acceptance of this quotation and the balance is payable after installation. For units-only orders (supply without installation), full payment is payable on acceptance.";
/** Online shop orders (Johan 2026-10-19 07:09): paid in full when the order is placed. Phone/Sam quotes keep PAYMENT_21. */
export const SHOP_PAYMENT_21 = "2.1 Online orders are paid in full when the order is placed. No further payment is due unless you approve extra work before it is done (see section 12).";

/**
 * Builds the terms & conditions blocks for a specific company/tenant.
 * The legal copy is generic boilerplate; only the company name and the
 * banking details are tenant-specific, and both are injected here instead
 * of being hardcoded, so every invoice/estimate/proposal PDF shows the
 * correct trading entity and real bank account — never a different
 * (unrelated) company's details.
 */
export const buildTermsBlocks = (company: TermsCompanyInfo = {}): TermsBlock[] => {
  if (company.customText && company.customText.trim()) {
    return [
      { type: "title", text: "Terms" },
      { type: "spacer", text: "" },
      ...company.customText.split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean)
        .map((para): TermsBlock => (/^[^\n]{1,60}:$/.test(para) ? { type: "heading", text: para } : { type: "paragraph", text: para })),
      ...(company.remoteQuote ? [{ type: "heading", text: REMOTE_QUOTE_HEADING } as TermsBlock, ...remoteQuoteParagraphs({ paidInFull: company.remotePaidInFull }).map((text): TermsBlock => ({ type: "paragraph", text }))] : []),
      ...relocationBlocks(company, company.remoteQuote ? 13 : 12),
    ];
  }
  const name = (company.companyName || FALLBACK_COMPANY_NAME).trim();

  const hasBankingDetails = Boolean(
    company.bankName || company.accountNumber || company.branchCode || company.accountType
  );

  // Johan 15 Oct 18:13: Deposit Reference is its own numbered section (8) straight after
  // Banking Details (7), with the same blue-circle heading styling as every other section.
  const DEPOSIT_REF = "Please use the Proposal number found at the top of the page as a reference when making the deposit.";
  const bankingSection: TermsBlock[] = hasBankingDetails
    ? [
        { type: "heading", text: "Banking Details:" },
        { type: "banking", text: `7.1 Account Name: ${company.accountName || name}` },
        ...(company.bankName ? [{ type: "banking", text: `7.2 Bank: ${company.bankName}` } as TermsBlock] : []),
        ...(company.accountType ? [{ type: "banking", text: `7.3 Account Type: ${company.accountType}` } as TermsBlock] : []),
        ...(company.accountNumber ? [{ type: "banking", text: `7.4 Account Number: ${company.accountNumber}` } as TermsBlock] : []),
        ...(company.branchCode ? [{ type: "banking", text: `7.5 Branch Code: ${company.branchCode}` } as TermsBlock] : []),
        { type: "spacer", text: "" },
      ]
    : [];

  const depositRefSection: TermsBlock[] = [
    { type: "heading", text: "Deposit Reference:" },
    { type: "paragraph", text: `8.1 ${DEPOSIT_REF}` },
    { type: "spacer", text: "" },
  ];

  return [
    { type: "title", text: "Terms" },
    { type: "spacer", text: "" },

    { type: "heading", text: "Scope of Work:" },
    { type: "paragraph", text: `1.1 Thank you for considering ${name}. By accepting this quotation, you appoint us to supply and install the air conditioning equipment and services described above, in accordance with the terms and conditions below.` },
    { type: "paragraph", text: "1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Pricing and Payment:" },
    { type: "paragraph", text: company.remotePaidInFull ? SHOP_PAYMENT_21 : company.legacyPayment ? LEGACY_PAYMENT_21 : PAYMENT_21 },
    { type: "paragraph", text: "2.2 All products supplied carry our full warranty as set out in section 5 below." },
    { type: "paragraph", text: "2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment." },
    { type: "paragraph", text: `2.4 All goods remain the property of ${name} until paid in full.` },
    { type: "spacer", text: "" },

    { type: "heading", text: "Electrical Work:" },
    { type: "paragraph", text: "3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board." },
    { type: "paragraph", text: "3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Building Work:" },
    { type: "paragraph", text: "4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Warranty:" },
    { type: "paragraph", text: "5.1 Two years warranty on all moving parts and a 3-year manufacturer's warranty on the compressor, subject to a service contract." },
    { type: "paragraph", text: `5.2 Our service contract extends the manufacturer's warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by ${name}.` },
    { type: "paragraph", text: "5.3 This warranty is in addition to, and does not replace or limit, any rights you have under the Consumer Protection Act 68 of 2008." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Errors and Omissions:" },
    { type: "paragraph", text: `6.1 While every effort is made to ensure the accuracy of quotations, estimates, invoices and related documentation, including descriptions, specifications, and pricing, ${name} shall not be held liable for any genuine clerical, typographical, printing, or administrative error or omission appearing in such documentation, provided that any such error is corrected as soon as it is identified and does not result in you being charged more than the fair value of the goods or services actually supplied.` },
    { type: "paragraph", text: "6.2 Product specifications, capacities and performance figures referenced in our documentation are based on information published by the relevant manufacturer or supplier. While we take reasonable care in relying on this information, we cannot guarantee against errors made by third-party manufacturers or suppliers. Should a material error in a manufacturer's specification affect the suitability of a unit for your requirements, we will work with you in good faith to find a fair resolution." },
    { type: "paragraph", text: "6.3 Nothing in this clause limits or excludes any right you may have under the Consumer Protection Act 68 of 2008, and this clause does not apply to, and does not limit our liability for, gross negligence, fraud, or wilful misconduct." },
    { type: "spacer", text: "" },

    ...bankingSection,
    ...depositRefSection,


    { type: "heading", text: "Confidentiality:" },
    { type: "paragraph", text: "9.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law or the Protection of Personal Information Act 4 of 2013 (POPIA)." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Termination:" },
    { type: "paragraph", text: "10.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination." },
    { type: "paragraph", text: "10.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Dispute Resolution:" },
    { type: "paragraph", text: "11.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably before referring the matter to the National Consumer Commission, an accredited consumer ombud, or a court of competent jurisdiction." },
    { type: "spacer", text: "" },

    ...(company.remoteQuote
      ? [{ type: "heading", text: REMOTE_QUOTE_HEADING } as TermsBlock, ...remoteQuoteParagraphs({ paidInFull: company.remotePaidInFull }).map((text): TermsBlock => ({ type: "paragraph", text })), { type: "spacer", text: "" } as TermsBlock]
      : []),

    ...relocationBlocks(company, company.remoteQuote ? 13 : 12),

    { type: "heading", text: "Importance of Servicing AC Units" },
    { type: "spacer", text: "" },

    { type: "heading", text: "Health and Safety Concerns:" },
    { type: "paragraph", text: "a. The health and safety of our customers are of utmost importance to us." },
    { type: "paragraph", text: "b. Regular servicing helps improve indoor air quality, reducing the risk of respiratory issues, allergies, and other health problems associated with poor air quality." },
    { type: "paragraph", text: "c. By addressing maintenance needs promptly, we ensure that your air conditioning system operates in a clean and safe manner, minimizing potential health risks." },
    { type: "paragraph", text: "d. Proper servicing also helps prevent the accumulation of mould, bacteria, and other harmful contaminants that can pose health hazards." },
    { type: "paragraph", text: "e. Additionally, routine maintenance plays a crucial role in mitigating the risk of Sick Building Syndrome, ensuring a healthier environment for both residential and commercial spaces." },
    { type: "spacer", text: "" },

    { type: "heading", text: "Daily Running Costs with Rising Energy Costs in Mind:" },
    { type: "paragraph", text: "a. We understand the concerns surrounding rising energy costs and the impact it has on your daily expenses." },
    { type: "paragraph", text: "b. Regular servicing and deep cleaning help ensure that your air conditioning unit operates at optimal efficiency, reducing its energy consumption and subsequently lowering your daily running costs." },
    { type: "paragraph", text: "c. Clean filters, coils, and vents allow the unit to cool your space more efficiently, requiring less energy to maintain a comfortable temperature." },
    { type: "paragraph", text: "d. By investing in servicing, you are taking a proactive step towards mitigating the impact of rising energy costs, helping you save money on your energy bills over time." },
    { type: "spacer", text: "" },

    { type: "heading", text: "For commercial air conditioning units," },
    { type: "paragraph", text: "a. We highly recommend scheduling servicing every 6 months." },
    { type: "paragraph", text: "b. Commercial units endure heavy usage and operate in demanding environments, making regular maintenance crucial for their performance and longevity." },
    { type: "paragraph", text: "c. Our AC Super Service deep clean method includes a comprehensive cleaning of all components, such as filters, coils, and vents." },
    { type: "paragraph", text: "d. Adhering to the recommended servicing schedule allows your commercial unit to operate at its peak efficiency, leading to lower daily running costs." },
    { type: "paragraph", text: "e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business's profitability." },
    { type: "paragraph", text: "f. Moreover, routine servicing helps us detect and address any potential issues promptly," },
    { type: "paragraph", text: "g. preventing costly breakdowns and major repairs that could disrupt your operations." },
    { type: "paragraph", text: "Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements" },
    { type: "spacer", text: "" },

    { type: "paragraph", text: "Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions." },
  ];
};

/** Legacy plain-text export for backwards compat (used in textarea defaults). Generic — not tied to any real company. */
export const DEFAULT_TERMS = buildTermsBlocks({})
  .filter((b) => b.type !== "spacer")
  .map((b) => b.text)
  .join("\n\n");

/** @deprecated Use `buildTermsBlocks(company)` instead — this generic fallback has no real company/banking data. */
export const TERMS_BLOCKS: TermsBlock[] = buildTermsBlocks({});
