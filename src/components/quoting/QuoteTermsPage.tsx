import { buildTermsBlocks, type TermsBlock } from "@/lib/defaultTerms";

/**
 * Full "Terms and conditions" page for quote PDFs (Johan 15 Oct 2026), in the
 * decided Bold design: numbered blue-circle section chips, uppercase blue
 * headings, two balanced columns, own page via data-pdf-break-before.
 * Same source text as every other terms surface (buildTermsBlocks).
 */

export interface TermsSection {
  heading: string;
  items: TermsBlock[];
}

/** Groups flat terms blocks into headed sections (title/spacers dropped). */
export function groupTermsSections(blocks: TermsBlock[]): TermsSection[] {
  const sections: TermsSection[] = [];
  let current: TermsSection | null = null;
  for (const b of blocks) {
    if (b.type === "title" || b.type === "spacer") continue;
    if (b.type === "heading") {
      // A heading with no clauses yet (e.g. "Importance of Servicing AC Units")
      // becomes an intro line of the next section instead of an empty section.
      if (current && current.items.length === 0 && current.heading) {
        current.items.push({ type: "paragraph", text: current.heading });
      }
      current = { heading: b.text.replace(/:\s*$/, ""), items: [] };
      sections.push(current);
    } else if (current) {
      current.items.push(b);
    } else {
      current = { heading: "", items: [b] };
      sections.push(current);
    }
  }
  return sections.filter((s) => s.heading || s.items.length);
}

export interface QuoteTermsPageProps {
  companyName: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  branchCode?: string;
  accountType?: string;
  quoteNumber?: string;
  /** Label before the number in the heading ("Quote" by default; invoices pass "Invoice"). */
  docLabel?: string;
  /** Invoices (Johan 2 Nov): the terms flow on under the closing cards and may span pages, so lay the two
   *  columns out row by row (01 02 / 03 04 ...). Each row is one keep block, so a page break always lands
   *  between rows and never slices a line in the other column; the heading stays with the first row. */
  rowFlow?: boolean;
  /** Phone/online quote: adds section 12. */
  remoteQuote?: boolean;
  /** Issued before the 2.1 payment change: keep the old wording. */
  legacyPayment?: boolean;
  /** Online shop order paid in full: 12.5 refund wording says "payment". */
  remotePaidInFull?: boolean;
}

const termsItemClass = (s: TermsSection, it: TermsBlock) =>
  `text-xs leading-relaxed text-ink ${/^(building|electrical) work$/i.test(s.heading) ? "font-bold" : it.type === "banking" || /^(banking details|deposit reference)$/i.test(s.heading) ? "font-bold" : ""}`;
const termsItemText = (it: TermsBlock) => (it.type === "bullet" ? `• ${it.text}` : it.text);

const TermsSectionBlock = ({ s, index }: { s: TermsSection; index: number }) => {
  const head = (
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-xs font-bold text-white">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h4 className="text-xs font-bold uppercase tracking-wide text-[#1AA7EC]">{s.heading || "Terms"}</h4>
        </div>
  );
  return (
      <div data-pdf-keep className="break-inside-avoid">
        {head}
        <div className="mt-1.5 space-y-1.5">
          {s.items.map((it, j) => (
            <p key={j} className={termsItemClass(s, it)}>
              {termsItemText(it)}
            </p>
          ))}
        </div>
      </div>
  );
};

const TermsSections = ({ sections, startIndex = 0 }: { sections: TermsSection[]; startIndex?: number }) => (
  <div className="space-y-4">
    {sections.map((s, i) => <TermsSectionBlock key={i} s={s} index={startIndex + i} />)}
  </div>
);

export default function QuoteTermsPage(p: QuoteTermsPageProps) {
  const blocks = buildTermsBlocks({
    companyName: p.companyName,
    bankName: p.bankName, accountName: p.accountName, accountNumber: p.accountNumber,
    branchCode: p.branchCode, accountType: p.accountType,
    remoteQuote: p.remoteQuote, legacyPayment: p.legacyPayment, remotePaidInFull: p.remotePaidInFull,
  });
  const sections = groupTermsSections(blocks);
  const half = Math.ceil(sections.length / 2);
  const left = sections.slice(0, half);
  const right = sections.slice(half);
  const heading = (
    <div className="flex items-baseline gap-3 border-b-2 border-[#1AA7EC] pb-2">
      <span className="border-l-4 border-[#F7941D] pl-2 text-base font-bold text-[#1B3A5C]">Terms and conditions</span>
      {p.quoteNumber && <span className="text-xs text-ink-muted">{p.docLabel || "Quote"} {p.quoteNumber}</span>}
    </div>
  );
  if (p.rowFlow) {
    const rows: TermsSection[][] = [];
    for (let i = 0; i < sections.length; i += 2) rows.push(sections.slice(i, i + 2));
    const row = (r: TermsSection[], ri: number) => (
      <div key={ri} data-pdf-keep data-testid="terms-row" className="fl-terms-grid grid grid-cols-1 gap-x-8 gap-y-4 break-inside-avoid">
        {r.map((s, j) => <TermsSectionBlock key={j} s={s} index={ri * 2 + j} />)}
      </div>
    );
    // pb-6: the terms are the last thing in the capture, and html2canvas draws text a few px lower than the
    // DOM box, so without room below the final line was clipped in half.
    return (
      <div data-pdf-terms-page data-paper data-testid="quote-terms-page" className="fl-terms-page fl-terms-compact mt-4 pt-2 pb-6">
        <div data-pdf-keep className="break-inside-avoid">
          {heading}
          {rows.length > 0 && <div className="mt-4">{row(rows[0], 0)}</div>}
        </div>
        {rows.length > 1 && <div className="mt-4 space-y-4">{rows.slice(1).map((r, i) => row(r, i + 1))}</div>}
      </div>
    );
  }
  return (
    <div data-pdf-terms-page data-paper data-testid="quote-terms-page" className="fl-terms-page mt-4 pt-2">
      <div className="flex items-baseline gap-3 border-b-2 border-[#1AA7EC] pb-2">
        <span className="border-l-4 border-[#F7941D] pl-2 text-base font-bold text-[#1B3A5C]">Terms and conditions</span>
        {p.quoteNumber && <span className="text-xs text-ink-muted">{p.docLabel || "Quote"} {p.quoteNumber}</span>}
      </div>
      {/* Two columns by the page's own width (container query), not the screen: the PDF capture root is
          always 820px, so a phone-made PDF now gets the same two-column terms as a desktop one (Q-2026-0047, 29 Oct). */}
      <div className="fl-terms-grid mt-4 grid grid-cols-1 gap-x-8 gap-y-4">
        <div data-pdf-keep className="space-y-4">
          <TermsSections sections={left} startIndex={0} />
        </div>
        <div data-pdf-keep className="space-y-4">
          <TermsSections sections={right} startIndex={left.length} />
        </div>
      </div>
    </div>
  );
}
