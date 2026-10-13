/**
 * Errors & omissions clause (Johan 2026-10-13 09:52). Fixed clause appended in code to the terms of every
 * quote and invoice (client link, PDF, print; Light and Bold) for every company, using that company's own name.
 */
export const eoeClause = (companyName?: string | null, docType: "quote" | "invoice" = "quote") => {
  const name = (companyName || "").trim() || "Massair CT (Pty) Ltd";
  const doc = docType === "invoice" ? "this document" : "this quotation";
  return `While every effort is made to ensure accuracy, ${doc} is subject to errors and omissions (E&OE). ${name} reserves the right to correct any pricing, specification or typographical errors before acceptance or invoicing. Prices are subject to supplier availability and may change without notice until a deposit is received.`;
};

/** Append the clause once (idempotent if a company already pasted it into its own terms). */
export const withEoe = (terms: string | null | undefined, companyName?: string | null, docType: "quote" | "invoice" = "quote") => {
  const base = (terms || "").trim();
  if (/\(E&OE\)/.test(base)) return base;
  const c = eoeClause(companyName, docType);
  return base ? `${base}\n\n${c}` : c;
};
