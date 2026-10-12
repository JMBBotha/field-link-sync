import { COMPANY_BLOCK_LINES, COMPANY_CONTACT_LINE } from "@/lib/companyIdentity";
interface DocumentHeaderProps {
  logoUrl?: string | null;
  companyName?: string;
  registrationNumber?: string;
  physicalAddress?: string;
  vatNumber?: string;
  phone?: string;
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
}: DocumentHeaderProps) => {
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

        {/* RIGHT: company block, single source src/lib/companyIdentity.ts (Johan 2026-10-12) */}
        <div data-testid="company-block" className="flex flex-col items-end text-right gap-0">
          {COMPANY_BLOCK_LINES.map((l, i) => (
            <p key={l} className={`text-[13px] leading-snug ${i === 0 ? "font-semibold text-foreground" : "text-foreground/80"}`}>{l}</p>
          ))}
          <p className="text-[12px] text-foreground/70 leading-snug">{COMPANY_CONTACT_LINE}</p>
        </div>
      </div>

      {/* DIVIDER */}
      <div className="mt-[11px] mb-[19px] h-px bg-border w-full" />
    </div>
  );
};

export default DocumentHeader;
