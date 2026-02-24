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
    <div>
      {/* HEADER ROW */}
      <div className="flex flex-row items-stretch justify-between gap-6">
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

        {/* RIGHT: FLEX COLUMN MATCHING LOGO HEIGHT */}
        <div className="flex flex-col items-end text-right justify-between">
          {/* GROUP 1 – TOP RIGHT (anchored to top) */}
          <div className="space-y-0">
            <p className="font-bold text-base text-foreground leading-tight">
              {companyName || "Your Company"}
            </p>
            <p className="text-sm text-muted-foreground leading-snug">6 Aviation Cress</p>
            <p className="text-sm text-muted-foreground leading-snug">Airport City</p>
            <p className="text-sm text-muted-foreground leading-snug">Cape Town</p>
            <p className="text-sm text-muted-foreground leading-snug">7100</p>
            {vatNumber && (
              <p className="text-sm font-medium text-muted-foreground leading-snug">
                VAT: {vatNumber}
              </p>
            )}
            {registrationNumber && (
              <p className="text-xs text-muted-foreground leading-snug">
                Reg No: {registrationNumber}
              </p>
            )}
          </div>

          {/* GROUP 2 – CONTACT LINE (anchored to bottom) */}
          <div className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
            0800 BE COOL — info@0800becool.co.za — www.0800becool.co.za
          </div>
        </div>
      </div>

      {/* DIVIDER */}
      <div className="mt-[11px] mb-[8px] h-px bg-border w-full" />
    </div>
  );
};

export default DocumentHeader;
