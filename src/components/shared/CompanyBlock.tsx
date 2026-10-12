import { COMPANY_BLOCK_LINES, COMPANY_CONTACT_LINE } from "@/lib/companyIdentity";

/** Right-aligned company block for quote/invoice documents. Single source: src/lib/companyIdentity.ts. */
export default function CompanyBlock({ className = "" }: { className?: string }) {
  const [name, ...rest] = COMPANY_BLOCK_LINES;
  return (
    <div data-testid="company-block" className={`text-right text-[12px] leading-relaxed text-slate-600 ${className}`}>
      <p className="text-[15px] font-bold text-[#1B3A5C]">{name}</p>
      {rest.map((l) => <p key={l}>{l}</p>)}
      <p className="text-[11px]">{COMPANY_CONTACT_LINE}</p>
    </div>
  );
}
