/**
 * Remote quotes (Johan 2026-10-18 22:08): quotes made by phone or online (Sam, phone Mandy, phone/website
 * lead, or the builder toggle) carry quotes.remote_quote = true and show terms section 12. Other quotes
 * look exactly as before. Approved wording: /workspace/remote-quote-site-check-2026-10-18/proposal.md.
 */
export const REMOTE_QUOTE_HEADING = "Quotes made by phone or online:";

export const remoteQuoteParagraphs = (): string[] => [
  "12.1 Your installation is booked using the information you gave us by phone or online, without a site visit beforehand. This quotation is based on that information.",
  "12.2 A standard back-to-back installation includes up to 3.5 m of piping. Electrical connection: 9,000–12,000 BTU units connect to the closest suitable plug point; 18,000 BTU inverter units connect to a plug top; larger units include an isolator allowance of R2,200 excl VAT for an isolator point from the DB board, using up to 15 m of cable.",
  "12.3 On the installation day, before any work starts, our technician will check the site with you. This covers whether the unit size suits the room (room size, sun exposure, top floor, kitchen and similar factors), unit positions, pipe length, wall type, working height and access, electrical supply, and any obstacles.",
  "12.4 Your installation costs are then confirmed and locked in with you before we start. If everything matches this quotation, we go ahead at the quoted price. If anything is different, for example a longer pipe run or a different unit size being needed, we will give you an updated quotation explaining the difference. We will not do, or charge for, any extra work unless you approve it first. Once confirmed, the price will not change for that installation.",
  "12.5 If you do not accept the updated quotation, you may cancel and we will refund your deposit in full.",
  "12.6 Nothing in this section limits your rights under the Consumer Protection Act 68 of 2008 or the Electronic Communications and Transactions Act 25 of 2002.",
];

/** One line for the quote email message and the short Terms box. */
export const REMOTE_QUOTE_NOTICE =
  "Your installation is booked from the details you gave us by phone or online. On the day, our technician will check the site and unit size with you, and your installation costs will be confirmed and locked in before any work starts. Nothing extra is done without your approval.";

/** Append the notice once to a quote's short terms text (only for remote quotes). */
export const withRemoteNotice = (terms: string | null | undefined, remote?: boolean | null): string => {
  const base = (terms || "").trim();
  if (!remote || base.includes("booked from the details you gave us")) return base;
  return base ? `${base}\n\n${REMOTE_QUOTE_NOTICE}` : REMOTE_QUOTE_NOTICE;
};

/**
 * Terms 2.1 payment wording changed on 2026-10-18 22:00 SAST. Quotes created before that keep the wording
 * they were issued with, so no past quote's terms change.
 */
export const PAYMENT_TERMS_V2_FROM = "2026-10-18T20:00:00Z";
export const usesLegacyPaymentTerms = (createdAt?: string | null): boolean => {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t < Date.parse(PAYMENT_TERMS_V2_FROM);
};
