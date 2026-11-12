import type { TermsBlock } from "@/lib/defaultTerms";

/**
 * Massair CT standard terms. Wording is the text stored on the imported quotes
 * (Q-2026-0056 and the other 5,587-character copies). Three corrections, listed
 * in ORIGINAL_TERMS_CORRECTIONS. No other wording changes.
 */
export const ORIGINAL_TERMS_CORRECTIONS = [
  '1.1 "Should u the client" → "Should you, the client"',
  '6.5 "Branch Code: [250 655]" → "Branch Code: 250 655" (stray brackets around the branch code)',
  'The sentence "Regular servicing plays a vital role..." was run onto clause g. It is its own line now, and the missing full stop after "replacements" is added.',
] as const;

export const ORIGINAL_TERMS_TEXT = `Scope of Work:
1.1 Should you, the client feel comfortable in appointing us for your HVAC project, We, Massair CT (Pty) Ltd, agree to provide air conditioning services as outlined in the quotation/estimate above.
1.2 The services will be carried out by experienced technicians in a professional manner, adhering to industry standards and safety guidelines.

Pricing and Payment:
2.1 To provide the best possible price, the cost of the unit/s is to be paid in full as acceptance of our quotation. The remainder of the installation amount is payable upon completion of the project.
2.2 All products supplied carry our full warranty as set out in section 5 below.
2.3 Unless previously arranged with management, it will be assumed that you, the client, will be responsible for payment.
2.4 All goods remain the property of Massair CT (Pty) Ltd until paid in full.

Electrical Work:
3.1 Please note that unless arranged otherwise, estimates exclude electrical connection to the DB Board.
3.2 A suitable electrical point needs to be provided within 1.5 m of the outdoor unit. For units with capacities of 24000Btu - 60000Btu. For units with capacities of 9000 - 18000, a suitable electrical/plug point needs to be provided.

Building Work:
4.1 Unless stated otherwise, our quotes exclude any building work, such as chase/core drilling and painting. These items will be quoted separately.

Warranty:
5.1 Two years warranty on all moving parts and a 3-year manufacturer's warranty on the compressor, subject to a service contract.
5.2 Our service contract extends the manufacturer's warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge. Please note that this warranty is only valid on new units supplied and installed by Massair CT (Pty) Ltd.

Banking Details:
6.1 Account Name: Massair CT (Pty) Ltd
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: 250 655

Deposit Reference:
7.1 Please use the Proposal number found at the top of the page as a reference when making the deposit.

Confidentiality:
8.1 We respect the privacy and confidentiality of our clients. Any information shared during the course of our engagement will be treated as confidential and will not be disclosed to third parties, except as required by law.

Termination:
9.1 Either party may terminate the agreement by providing written notice to the other party, specifying the reasons for termination.
9.2 Termination may result in the settlement of outstanding payments for services already provided, as per the agreed terms.

Dispute Resolution:
10.1 In the event of any disputes or disagreements arising from our services, both parties agree to engage in good-faith negotiations to resolve the matter amicably.

Importance of Servicing AC Units

Health and Safety Concerns:
a. The health and safety of our customers are of utmost importance to us.
b. Regular servicing helps improve indoor air quality, reducing the risk of respiratory issues, allergies, and other health problems associated with poor air quality.
c. By addressing maintenance needs promptly, we ensure that your air conditioning system operates in a clean and safe manner, minimizing potential health risks.
d. Proper servicing also helps prevent the accumulation of mould, bacteria, and other harmful contaminants that can pose health hazards.
e. Additionally, routine maintenance plays a crucial role in mitigating the risk of Sick Building Syndrome, ensuring a healthier environment for both residential and commercial spaces.

Daily Running Costs with Rising Energy Costs in Mind:
a. We understand the concerns surrounding rising energy costs and the impact it has on your daily expenses.
b. Regular servicing and deep cleaning help ensure that your air conditioning unit operates at optimal efficiency, reducing its energy consumption and subsequently lowering your daily running costs.
c. Clean filters, coils, and vents allow the unit to cool your space more efficiently, requiring less energy to maintain a comfortable temperature.
d. By investing in servicing, you are taking a proactive step towards mitigating the impact of rising energy costs, helping you save money on your energy bills over time.

For commercial air conditioning units,
a. We highly recommend scheduling servicing every 6 months.
b. Commercial units endure heavy usage and operate in demanding environments, making regular maintenance crucial for their performance and longevity.
c. Our AC Super Service deep clean method includes a comprehensive cleaning of all components, such as filters, coils, and vents.
d. Adhering to the recommended servicing schedule allows your commercial unit to operate at its peak efficiency, leading to lower daily running costs.
e. Neglecting regular servicing may result in decreased efficiency, increased energy consumption, and higher energy costs, impacting your business's profitability.
f. Moreover, routine servicing helps us detect and address any potential issues promptly,
g. preventing costly breakdowns and major repairs that could disrupt your operations.
Regular servicing plays a vital role in minimizing the risk of premature system failure and the need for costly replacements.
Please note that Service recommendations are provided in a manner to emphasize the benefits of regular servicing and the potential cost savings. However, it is important to be aware that neglecting servicing results in reduced performance, increased energy consumption, higher daily running costs, and potential system malfunctions.`;

const CLAUSE = /^(\d+\.\d+|[a-z]\.)\s+/;

export interface OriginalSection {
  /** Blue-circle heading, colon already removed. */
  heading: string;
  /** A title that had no clauses of its own, kept with this section so it is not stranded. */
  kicker?: string;
  lines: string[];
}

function isHeading(line: string): boolean {
  if (CLAUSE.test(line)) return false;
  if (line.endsWith(":")) return true;
  if (/^importance of servicing ac units$/i.test(line)) return true;
  if (/^for commercial air conditioning units,?$/i.test(line)) return true;
  return false;
}

/** Sections for the terms page. Blank lines are gaps, not extra space. */
export function originalTermsSections(text: string = ORIGINAL_TERMS_TEXT): OriginalSection[] {
  const sections: OriginalSection[] = [];
  let current: OriginalSection | null = null;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      const heading = line.replace(/:\s*$/, "").replace(/,\s*$/, "");
      if (current && current.lines.length === 0) {
        current.kicker = current.heading;
        current.heading = heading;
      } else {
        current = { heading, lines: [] };
        sections.push(current);
      }
      continue;
    }
    if (!current) {
      current = { heading: "Terms", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections.filter((s) => s.heading || s.lines.length);
}

/** What a Massair CT quote page shows. The known imported copy (typos included) becomes the corrected standard. */
export function displayTermsText(stored?: string | null): string {
  const t = (stored || "").replace(/\r\n/g, "\n").trim();
  if (!t) return ORIGINAL_TERMS_TEXT;
  if (t === ORIGINAL_TERMS_TEXT) return ORIGINAL_TERMS_TEXT;
  const known = t.includes("Scope of Work:") && t.includes("63226563591") && (t.includes("Should u the client") || t.includes("Should you, the client"));
  return known ? ORIGINAL_TERMS_TEXT : t;
}

export function clauseParts(text: string): { label: string; body: string } | null {
  const m = text.match(/^(\d+\.\d+|[a-z]\.)\s+([\s\S]+)$/);
  return m ? { label: m[1], body: m[2] } : null;
}

export function sectionItemType(heading: string): TermsBlock["type"] {
  return /banking details|deposit reference/i.test(heading) ? "banking" : "paragraph";
}
