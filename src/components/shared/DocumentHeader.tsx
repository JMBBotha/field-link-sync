import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";
import { profileBlockLines, profileContactLine, type CompanyProfile } from "@/lib/companyProfiles";
interface DocumentHeaderProps {
  logoUrl?: string | null;
  companyName?: string;
  registrationNumber?: string;
  physicalAddress?: string;
  vatNumber?: string;
  phone?: string;
  /** Issuing company profile (invoices). Omit = the fixed block. */
  profile?: Partial<CompanyProfile> | null;
  /** Document's company; omit = signed-in user's company. Header always reads that company's record. */
  companyId?: string | null;
}

/**
 * Shared document header for quotes, invoices, and proposals.
 *
 * Layout: Logo left | Right column with company identity stacked top-aligned.
 * Matches reference invoice layout exactly.
 */
const DocumentHeader = ({
  logoUrl,
  companyName,
  registrationNumber,
  physicalAddress,
  vatNumber,
  phone,
  profile,
  companyId,
}: DocumentHeaderProps) => {
  const p = useDocumentCompanyProfile(companyId, profile);
  const blockLines = profileBlockLines(p);
  const contactLine = profileContactLine(p);
  return (
    <div>
      {/* HEADER ROW */}
      <div className="flex flex-row items-start justify-between gap-6">
        {/* LEFT: LOGO ONLY */}
        <div className="shrink-0 max-w-[50%] flex items-start">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Company logo"
              className="max-h-[165px] w-auto object-contain"
            />
          ) : (
            <p className="text-2xl font-black tracking-tight text-foreground">
              {companyName || "Your Company"}
            </p>
          )}
        </div>

        {/* RIGHT: company block from the company record (company_profiles), fixed block only as fallback (Johan 2026-10-12) */}
        <div data-testid="company-block" data-company-source={p?.legal_name ? "record" : "fallback"} className="flex flex-col items-end text-right gap-0">
          {blockLines.map((l, i) => (
            <p key={l} className={`text-xs leading-snug ${i === 0 ? "font-semibold text-foreground" : "text-foreground/80"}`}>{l}</p>
          ))}
          <p className="text-xs text-foreground/70 leading-snug">{contactLine}</p>
        </div>
      </div>

      {/* DIVIDER */}
      <div className="mt-[11px] mb-[19px] h-px bg-border w-full" />
    </div>
  );
};

export default DocumentHeader;
