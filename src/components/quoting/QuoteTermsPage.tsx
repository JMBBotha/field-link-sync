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
}

const TermsSections = ({ sections, startIndex = 0 }: { sections: TermsSection[]; startIndex?: number }) => (
  <div className="space-y-4">
    {sections.map((s, i) => (
      <div key={i} className="break-inside-avoid">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-[10px] font-bold text-white">
            {String(startIndex + i + 1).padStart(2, "0")}
          </span>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#1AA7EC]">{s.heading || "Terms"}</h4>
        </div>
        <div className="mt-1.5 space-y-1.5">
          {s.items.map((it, j) => (
            <p key={j} className={`text-[10px] leading-relaxed text-slate-700 ${it.type === "banking" ? "font-semibold" : ""}`}>
              {it.type === "bullet" ? `• ${it.text}` : it.text}
            </p>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default function QuoteTermsPage(p: QuoteTermsPageProps) {
  const blocks = buildTermsBlocks({
    companyName: p.companyName,
    bankName: p.bankName, accountName: p.accountName, accountNumber: p.accountNumber,
    branchCode: p.branchCode, accountType: p.accountType,
  });
  const sections = groupTermsSections(blocks);
  const half = Math.ceil(sections.length / 2);
  const left = sections.slice(0, half);
  const right = sections.slice(half);
  return (
    <div data-html2canvas-ignore data-testid="quote-terms-page" className="mt-8 pt-6">
      <div className="flex items-baseline gap-3 border-b-2 border-[#1AA7EC] pb-2">
        <span className="border-l-4 border-[#F7941D] pl-2 text-[16px] font-bold text-[#1B3A5C]">Terms and conditions</span>
        {p.quoteNumber && <span className="text-[10px] text-slate-400">Quote {p.quoteNumber}</span>}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <TermsSections sections={left} />
        <TermsSections sections={right} startIndex={left.length} />
      </div>
    </div>
  );
}
