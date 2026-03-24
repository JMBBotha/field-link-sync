/**
 * Structured terms data for formatted PDF rendering.
 * Each block has a type that controls how it renders in the PDF:
 *   - "title": centered, bold, larger font
 *   - "heading": centered, bold section heading (e.g. "1. Scope of Work")
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

export const TERMS_BLOCKS: TermsBlock[] = [
  { type: "title", text: "MassAir Ind cc – Terms and Conditions for Quotations and Air Conditioning Services" },
  { type: "spacer", text: "" },

  { type: "heading", text: "1. Scope of Work" },
  { type: "paragraph", text: "1.1 Upon your acceptance of this quotation (by payment of the deposit or full unit cost as specified), MassAir Ind cc agrees to supply and install the air conditioning equipment and perform the services detailed in the quotation." },
  { type: "paragraph", text: "1.2 All work will be carried out by qualified, experienced technicians in a professional manner, in compliance with relevant industry standards, safety regulations, and manufacturer guidelines." },
  { type: "spacer", text: "" },

  { type: "heading", text: "2. Pricing and Payment Terms" },
  { type: "paragraph", text: "2.1 To secure the best pricing and confirm your order, the full cost of the air conditioning unit(s) is payable upfront upon acceptance of this quotation. The balance for installation and any additional services is due upon satisfactory completion of the project." },
  { type: "paragraph", text: "2.2 All products supplied by MassAir Ind cc carry the manufacturer's warranty as detailed in Section 5, plus our workmanship warranty." },
  { type: "paragraph", text: "2.3 Unless alternative payment arrangements are agreed in writing by management, the client is responsible for all payments." },
  { type: "paragraph", text: "2.4 Ownership of all goods and equipment remains with MassAir Ind cc until payment is received in full." },
  { type: "paragraph", text: "2.5 Prices are valid for 30 days from the date of the quotation unless otherwise stated." },
  { type: "spacer", text: "" },

  { type: "heading", text: "3. Electrical Requirements" },
  { type: "paragraph", text: "3.1 Unless explicitly included in the quotation, electrical work (including connection to the distribution board/DB board) is excluded. Any required electrical upgrades or connections will be quoted separately." },
  { type: "paragraph", text: "3.2 A suitable electrical point (plug or isolator) must be provided by the client within 1.5 meters of the outdoor unit location." },
  { type: "bullet", text: "For units 24,000 BTU to 60,000 BTU: A dedicated electrical circuit and isolator are required." },
  { type: "bullet", text: "For units 9,000 BTU to 18,000 BTU: A standard plug point is sufficient, provided it meets load requirements." },
  { type: "spacer", text: "" },

  { type: "heading", text: "4. Building and Structural Work" },
  { type: "paragraph", text: "4.1 Unless specifically itemized in the quotation, all building-related work is excluded. This includes chase cutting, core drilling, making good surfaces, plastering, painting, or any structural modifications." },
  { type: "paragraph", text: "4.2 Such work can be quoted separately if required. We recommend coordinating with a qualified builder or contractor where necessary." },
  { type: "spacer", text: "" },

  { type: "heading", text: "5. Warranty" },
  { type: "paragraph", text: "5.1 Standard warranty: 2 years on all moving parts and a 3-year manufacturer's warranty on the compressor (subject to compliance with service requirements)." },
  { type: "paragraph", text: "5.2 Extended compressor warranty: When you enter into our recommended service contract, the compressor warranty is extended to 5 years. In the event of compressor failure during this period, we will supply and install the replacement compressor free of charge (labor and part)." },
  { type: "paragraph", text: "5.3 Warranty applies only to new equipment supplied and installed by MassAir Ind cc. It excludes failures due to misuse, neglect, improper maintenance, or third-party interference. Regular servicing as recommended is required to maintain warranty validity." },
  { type: "spacer", text: "" },

  { type: "heading", text: "6. Banking Details" },
  { type: "banking", text: "Account Name: MASSAIR IND CC" },
  { type: "banking", text: "Bank: FNB" },
  { type: "banking", text: "Account Type: Cheque Account" },
  { type: "banking", text: "Account Number: 62326769075" },
  { type: "banking", text: "Branch Code: 250 655" },
  { type: "spacer", text: "" },

  { type: "heading", text: "7. Deposit / Payment Reference" },
  { type: "paragraph", text: "Please use the Proposal/Quotation number (found at the top of the document) as the payment reference." },
  { type: "spacer", text: "" },

  { type: "heading", text: "8. Confidentiality" },
  { type: "paragraph", text: "We value your privacy. All information provided by you will be treated as confidential and used solely for the purpose of delivering our services. It will not be disclosed to third parties except as required by law." },
  { type: "spacer", text: "" },

  { type: "heading", text: "9. Termination" },
  { type: "paragraph", text: "Either party may terminate this agreement by providing written notice to the other, stating the reasons. Upon termination, you agree to settle any outstanding payments for goods supplied and services already rendered." },
  { type: "spacer", text: "" },

  { type: "heading", text: "10. Dispute Resolution" },
  { type: "paragraph", text: "In the event of any dispute, both parties agree to first attempt resolution through good-faith discussions. If unresolved, the matter may be referred to mediation or relevant authorities as appropriate." },
  { type: "spacer", text: "" },

  { type: "heading", text: "Important Information: The Value of Regular Air Conditioning Servicing" },
  { type: "paragraph", text: "Regular maintenance is essential for optimal performance, energy efficiency, and longevity of your system. Neglecting servicing can lead to:" },
  { type: "bullet", text: "Reduced cooling/heating efficiency" },
  { type: "bullet", text: "Higher energy consumption and increased electricity costs (especially with rising tariffs)" },
  { type: "bullet", text: "Potential breakdowns, costly repairs, or premature replacement" },
  { type: "spacer", text: "" },

  { type: "heading", text: "Health & Indoor Air Quality Benefits" },
  { type: "paragraph", text: "Routine servicing removes dust, mould, bacteria, and allergens, improving indoor air quality and reducing risks of respiratory issues, allergies, or Sick Building Syndrome. This is especially important in homes and commercial spaces." },
  { type: "spacer", text: "" },

  { type: "heading", text: "Energy Cost Savings" },
  { type: "paragraph", text: "With clean coils, filters, and components, your unit runs more efficiently—using less electricity to achieve the same comfort level. Regular deep cleaning (our AC Super Service) can significantly lower daily running costs over time." },
  { type: "spacer", text: "" },

  { type: "heading", text: "Recommended Servicing Schedule" },
  { type: "bullet", text: "Residential units: At least once a year (ideally before peak season).", boldPrefix: "Residential units" },
  { type: "bullet", text: "Commercial units: Every 6 months, due to heavier usage and demanding conditions.", boldPrefix: "Commercial units" },
  { type: "paragraph", text: "Our comprehensive service includes cleaning filters, coils, drains, vents, checking refrigerant levels, and inspecting for potential issues—helping detect problems early, prevent downtime, and protect your investment." },
  { type: "spacer", text: "" },
  { type: "paragraph", text: "We provide these recommendations to help you maximize comfort, efficiency, and savings—not as an obligation, but as best practice for long-term system health." },
  { type: "spacer", text: "" },
  { type: "paragraph", text: "If you have any questions or need clarification on any aspect of this quotation, please contact us—we're here to help ensure your complete satisfaction." },
  { type: "spacer", text: "" },
  { type: "paragraph", text: "Thank you for considering MassAir Ind cc for your air conditioning needs." },
];

/** Legacy plain-text export for backwards compat (used in textarea defaults) */
export const DEFAULT_TERMS = TERMS_BLOCKS
  .filter((b) => b.type !== "spacer")
  .map((b) => b.text)
  .join("\n\n");
