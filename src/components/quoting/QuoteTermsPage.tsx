import { buildTermsBlocks, type TermsBlock } from "@/lib/defaultTerms";
import { clauseParts, displayTermsText, originalTermsSections, sectionItemType } from "@/lib/originalTerms";

/**
 * Full "Terms and conditions" page for quote PDFs (Johan 15 Oct 2026), in the
 * decided Bold design: numbered blue-circle section chips, uppercase blue
 * headings, two balanced columns, own page via data-pdf-break-before.
 * Same source text as every other terms surface (buildTermsBlocks).
 */

export interface TermsSection {
  heading: string;
  items: TermsBlock[];
  /** Title with no clauses of its own, printed with this section so it is not left alone. */
  kicker?: string;
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
  /** Quotes and invoices: lay the two columns out row by row (01 02 / 03 04 ...). A page break can land
   *  between points, never through a line or through the other column. The "Terms and conditions" heading
   *  stays with the first row, so it cannot sit alone above a blank page. */
  rowFlow?: boolean;
  /** Phone/online quote: adds section 12. */
  remoteQuote?: boolean;
  /** Issued before the 2.1 payment change: keep the old wording. */
  legacyPayment?: boolean;
  /** Online shop order paid in full: 12.5 refund wording says "payment". */
  remotePaidInFull?: boolean;
  /**
   * Massair CT original wording. When set, this text is the page (not the generated 11-section copy).
   * Pass the quote's terms_text; an empty value uses the corrected imported standard.
   */
  sourceText?: string | null;
}

const termsItemClass = (s: TermsSection, it: TermsBlock) =>
  `text-xs leading-relaxed text-ink ${/^(building|electrical) work$/i.test(s.heading) ? "font-bold" : it.type === "banking" || /^(banking details|deposit reference)$/i.test(s.heading) ? "font-bold" : ""}`;
const termsItemText = (it: TermsBlock) => (it.type === "bullet" ? `• ${it.text}` : it.text);

/** Numbered clause: the number sits in its own column so wrapped lines line up under the words. */
const ClauseBody = ({ text, className, align }: { text: string; className: string; align?: boolean }) => {
  const parts = align ? clauseParts(text) : null;
  if (!parts) return <p className={className}>{text}</p>;
  return (
    <p className={`${className} grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2`}>
      <span className="tabular-nums">{parts.label} </span>
      <span>{parts.body}</span>
    </p>
  );
};

/** pointKeep (invoice rowFlow, Johan 2 Nov 21:10): the page may break between points, never inside one;
 *  the heading stays with the first point. Whole-section keeps pushed long sections to the next page. */
const TermsSectionBlock = ({ s, index, pointKeep, align }: { s: TermsSection; index: number; pointKeep?: boolean; align?: boolean }) => {
  const gap = align ? "mt-2" : "mt-1.5";
  const head = (
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-xs font-bold text-white">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h4 className="text-xs font-bold uppercase tracking-wide text-[#1AA7EC]">{s.heading || "Terms"}</h4>
        </div>
  );
  const kicker = s.kicker ? (
    <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[#1B3A5C]">{s.kicker}</p>
  ) : null;
  if (pointKeep && s.items.length > 0) {
    const [first, ...rest] = s.items;
    return (
      <div data-testid="terms-section">
        <div data-pdf-keep>
          {kicker}
          {head}
          <ClauseBody text={termsItemText(first)} align={align} className={`${gap} ${termsItemClass(s, first)}`} />
        </div>
        {rest.map((it, j) => (
          <div key={j} data-pdf-keep>
            <ClauseBody text={termsItemText(it)} align={align} className={`${gap} ${termsItemClass(s, it)}`} />
          </div>
        ))}
      </div>
    );
  }
  return (
      <div data-pdf-keep className="break-inside-avoid">
        {kicker}
        {head}
        <div className={`${gap} space-y-2`}>
          {s.items.map((it, j) => (
            <ClauseBody key={j} text={termsItemText(it)} align={align} className={termsItemClass(s, it)} />
          ))}
        </div>
      </div>
  );
};

const TermsSections = ({ sections, startIndex = 0, align }: { sections: TermsSection[]; startIndex?: number; align?: boolean }) => (
  <div className={align ? "space-y-5" : "space-y-4"}>
    {sections.map((s, i) => <TermsSectionBlock key={i} s={s} index={startIndex + i} align={align} />)}
  </div>
);

function sectionsFor(p: QuoteTermsPageProps): { sections: TermsSection[]; original: boolean } {
  if (p.sourceText !== undefined) {
    const text = displayTermsText(p.sourceText);
    const sections: TermsSection[] = originalTermsSections(text).map((s) => ({
      heading: s.heading,
      kicker: s.kicker,
      items: s.lines.map((line) => ({ type: sectionItemType(s.heading), text: line })),
    }));
    return { sections, original: true };
  }
  const blocks = buildTermsBlocks({
    companyName: p.companyName,
    bankName: p.bankName, accountName: p.accountName, accountNumber: p.accountNumber,
    branchCode: p.branchCode, accountType: p.accountType,
    remoteQuote: p.remoteQuote, legacyPayment: p.legacyPayment, remotePaidInFull: p.remotePaidInFull,
  });
  return { sections: groupTermsSections(blocks), original: false };
}

export default function QuoteTermsPage(p: QuoteTermsPageProps) {
  const { sections, original } = sectionsFor(p);
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
      <div key={ri} data-testid="terms-row" className={`fl-terms-grid grid grid-cols-1 gap-x-8 ${original ? "gap-y-5" : "gap-y-4"}`}>
        {r.map((s, j) => <TermsSectionBlock key={j} s={s} index={ri * 2 + j} pointKeep align={original} />)}
      </div>
    );
    // pb-6: the terms are the last thing in the capture, and html2canvas draws text a few px lower than the
    // DOM box, so without room below the final line was clipped in half.
    // The heading and the first row share one keep (Q-2026-0053): two full-height column keeps made the
    // cutter walk up, leaving the heading alone and a short block at the top of each following page.
    return (
      <div data-pdf-terms-page data-paper data-testid="quote-terms-page" className={`fl-terms-page fl-terms-compact mt-4 pt-2 pb-6 ${original ? "fl-terms-original" : ""}`}>
        <div data-pdf-keep data-testid="terms-heading-keep">
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
          <TermsSections sections={left} startIndex={0} align={original} />
        </div>
        <div data-pdf-keep className="space-y-4">
          <TermsSections sections={right} startIndex={left.length} align={original} />
        </div>
      </div>
    </div>
  );
}
