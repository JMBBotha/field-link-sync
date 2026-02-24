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

        {/* RIGHT: STACKED IDENTITY – all right-aligned, top-anchored */}
        <div className="flex flex-col items-end text-right gap-0">
          {/* Line 1: Registration line (bolder) */}
          <p className="text-[13px] font-semibold text-foreground leading-snug">
            CT - {companyName || "Your Company"}
            {vatNumber ? ` - VAT ${vatNumber}` : ""}
          </p>
          {/* Line 2: Phone */}
          {phone && (
            <p className="text-[13px] text-foreground/80 leading-snug">{phone}</p>
          )}
          {/* Lines 3–6: Address */}
          <p className="text-[13px] text-foreground/80 leading-snug">6 Aviation Cress</p>
          <p className="text-[13px] text-foreground/80 leading-snug">Airport City</p>
          <p className="text-[13px] text-foreground/80 leading-snug">Cape Town</p>
          <p className="text-[13px] text-foreground/80 leading-snug">7100</p>
          {/* Line 7: VAT Number */}
          {vatNumber && (
            <p className="text-[13px] text-foreground/80 leading-snug">
              VAT Number {vatNumber}
            </p>
          )}
        </div>
      </div>

      {/* DIVIDER */}
      <div className="mt-[11px] mb-[19px] h-px bg-border w-full" />
    </div>
  );
};

export default DocumentHeader;
