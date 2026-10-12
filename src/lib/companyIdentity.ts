/**
 * ONE source for the company block on every client document (Johan 2026-10-12 09:14):
 * quotes, quote PDFs, client quote page, invoices, deposit invoices, statements, credit notes,
 * T&C pages and email footers. Exact wording from Johan. Banking is NOT here: it always comes
 * from company_settings (newest row) via cleanBanking() below, so nobody invents account numbers.
 */
export const COMPANY = {
  legalName: "MASSAIR CT (PTY) Ltd",
  brand: "0800-BE-COOL AC Super Service",
  tel: "(021) 802-2889",
  whatsapp: "069 683 8624",
  vatNo: "4630313080",
  addressLines: ["9A Cabernet Rd, Blackheath Ind", "Cape Town", "7580"],
  web: "www.0800becool.co.za",
  email: "info@0800becool.co.za",
  vatRatePercent: 15,
} as const;

/** The exact block Johan sent, one entry per line. */
export const COMPANY_BLOCK_LINES: string[] = [
  COMPANY.legalName,
  COMPANY.tel,
  `VAT No ${COMPANY.vatNo}`,
  ...COMPANY.addressLines,
];

/** Contact line used under the block / in footers. */
export const COMPANY_CONTACT_LINE = `WhatsApp/Cell ${COMPANY.whatsapp} · ${COMPANY.email} · ${COMPANY.web}`;

export interface CleanBanking {
  account_name: string;
  bank_name: string;
  account_number: string;
  branch_code: string;
  account_type: string;
}

/** Normalise company_settings.banking_details: trim, drop stray brackets/typos like "250 655]", default the account name. */
export function cleanBanking(raw: any): CleanBanking {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "").replace(/[\[\]{}()]/g, "").replace(/\s+/g, " ").trim();
  const type = s(b.account_type);
  return {
    account_name: s(b.account_name) || COMPANY.legalName,
    bank_name: s(b.bank_name ?? b.bank),
    account_number: s(b.account_number),
    branch_code: s(b.branch_code),
    account_type: type.match(/^[A-Za-z ]+/)?.[0].trim() || type,
  };
}

/** True when banking is missing the essentials (shown as "—" and flagged to staff, never invented). */
export function bankingIncomplete(b: CleanBanking): boolean {
  return !b.bank_name || !b.account_number || !b.branch_code;
}

/** Same block as HTML for the printable statement / credit note pages. */
export function companyBlockHtml(esc: (s: string) => string): string {
  const [name, ...rest] = COMPANY_BLOCK_LINES;
  return `<div style="text-align:right" data-company-block><strong>${esc(name)}</strong><br/><span class="muted">${rest.map(esc).join("<br/>")}<br/>${esc(COMPANY_CONTACT_LINE)}</span></div>`;
}
