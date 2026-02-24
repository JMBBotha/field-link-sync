interface DocumentHeaderProps {
  logoUrl?: string | null;
  companyName?: string;
  registrationNumber?: string;
  physicalAddress?: string;
  vatNumber?: string;
}

/**
 * Shared document header for quotes, invoices, and proposals.
 *
 * Layout: Logo left | Right column split into Group 1 (top) and Group 2 (bottom).
 * Group 1 – Company identity anchored to the top-right.
 * Group 2 – Contact details aligned with the bottom of the logo.
 */
const DocumentHeader = ({
  logoUrl,
  companyName,
  registrationNumber,
  physicalAddress,
  vatNumber,
}: DocumentHeaderProps) => {
  return (
    <>
      <div className="flex flex-row items-stretch justify-between py-3 gap-8 min-h-[120px]">
        {/* Logo – left */}
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

        {/* Right column – stretches full height of header */}
        <div className="flex flex-col items-end text-right ml-auto justify-between">
          {/* Group 1 — Company Identity (top-right) */}
          <div className="space-y-0.5">
            <p className="font-bold text-base text-foreground leading-tight">
              {companyName || "Your Company"}
            </p>
            {registrationNumber && (
              <p className="text-xs text-muted-foreground">
                Reg No: {registrationNumber}
              </p>
            )}
            {physicalAddress && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {physicalAddress}
              </p>
            )}
            {vatNumber && (
              <p className="text-sm font-medium text-muted-foreground">
                VAT: {vatNumber}
              </p>
            )}
          </div>

          {/* Group 2 — Contact Details (bottom-right, aligned with logo bottom) */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/60">
            <span>0800 BE COOL</span>
            <span className="text-muted-foreground/30">–</span>
            <span>info@0800becool.co.za</span>
            <span className="text-muted-foreground/30">–</span>
            <span>www.0800becool.co.za</span>
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />
    </>
  );
};

export default DocumentHeader;
