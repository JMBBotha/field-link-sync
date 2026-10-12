import { COMPANY_BLOCK_LINES, COMPANY_CONTACT_LINE } from "@/lib/companyIdentity";
import { profileBlockLines, profileContactLine, type CompanyProfile } from "@/lib/companyProfiles";

/**
 * Right-aligned company block for quote/invoice documents.
 * With a `profile` (invoices: the issuing company) it prints that company's own name/VAT/address;
 * without one it prints the fixed block from src/lib/companyIdentity.ts (unchanged).
 */
export default function CompanyBlock({ className = "", profile }: { className?: string; profile?: Partial<CompanyProfile> | null }) {
  const [name, ...rest] = profile?.legal_name ? profileBlockLines(profile) : COMPANY_BLOCK_LINES;
  const contact = profile?.legal_name ? profileContactLine(profile) : COMPANY_CONTACT_LINE;
  return (
    <div data-testid="company-block" className={`text-right text-[12px] leading-relaxed text-slate-600 ${className}`}>
      <p className="text-[15px] font-bold text-[#1B3A5C]">{name}</p>
      {rest.map((l) => <p key={l}>{l}</p>)}
      {contact && <p className="text-[11px]">{contact}</p>}
    </div>
  );
}
