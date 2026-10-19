/**
 * Online shop terms (Johan 2026-10-19): the shop sells supply + standard install, PAID IN FULL online.
 * Section 12 is the approved "Quotes made by phone or online" wording (src/lib/remoteQuoteClause.ts) with one
 * shop-only change in 12.5: "refund your payment in full" (shop clients pay in full, not a deposit).
 * Keep in step with src/lib/remoteQuoteClause.ts (src/test/shopTerms.test.ts checks it).
 */
export const SHOP_TERMS_VERSION = "shop-2026-10-19";
export const SHOP_TERMS_HEADING = "Quotes made by phone or online:";
export const SHOP_TERMS_PARAGRAPHS: string[] = [
  "12.1 Your installation is booked using the information you gave us by phone or online, without a site visit beforehand. This quotation is based on that information.",
  "12.2 A standard back-to-back installation includes up to 3.5 m of piping. Electrical connection: 9,000–12,000 BTU units connect to the closest suitable plug point; 18,000 BTU inverter units connect to a plug top; larger units include an isolator allowance of R2,200 excl VAT for an isolator point from the DB board, using up to 15 m of cable.",
  "12.3 On the installation day, before any work starts, our technician will check the site with you. This covers whether the unit size suits the room (room size, sun exposure, top floor, kitchen and similar factors), unit positions, pipe length, wall type, working height and access, electrical supply, and any obstacles.",
  "12.4 Your installation costs are then confirmed and locked in with you before we start. If everything matches this quotation, we go ahead at the quoted price. If anything is different, for example a longer pipe run or a different unit size being needed, we will give you an updated quotation explaining the difference. We will not do, or charge for, any extra work unless you approve it first. Once confirmed, the price will not change for that installation.",
  "12.5 If you do not accept the updated quotation, you may cancel and we will refund your payment in full.",
  "12.6 Nothing in this section limits your rights under the Consumer Protection Act 68 of 2008 or the Electronic Communications and Transactions Act 25 of 2002.",
];
export const SHOP_EXTRAS_LINE =
  "Extras are only charged if you approve them on the day (for example piping beyond 3.5 m, or electrical work beyond the allowance).";

export const SHOP_CONTACT = {
  sam_whatsapp: "069 683 8624",
  sam_whatsapp_link: "https://wa.me/27696838624",
  phone: "(021) 802 2889",
  phone_link: "tel:+27218022889",
};
