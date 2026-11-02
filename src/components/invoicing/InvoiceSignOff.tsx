import logoLight from "@/assets/brand/logo-light.png";
import units from "@/assets/brand/units.png";
import { SIGNATURE_COMPANY } from "@/lib/emailSignature";
import { profileIdentity } from "@/lib/companyProfiles";
import type { CompanyProfile } from "@/lib/companyProfiles";

/**
 * Company sign-off at the very end of an invoice, after the terms (Johan 2 Nov 21:10: "page 3 looks dead,
 * put company info like the mail signature there"). Same data and look as the email signature
^ * (emailSignature.ts): logo | blue bar | company lines, V8 colours. Company data comes only from the issuing
 * company's own record via signatureCompanyFromProfile; Massair CT keeps the designed block.
 */
/* data-pdf-bottom (Johan 2 Nov 21:28 "signature should be at bottom of page"): the PDF pins it to the bottom of the last page. */
export default function InvoiceSignOff({ profile }: { profile?: Partial<CompanyProfile> | null }) {
  // Company-specific (Johan 2 Nov 21:33): every line comes from the issuing company's record via
  // profileIdentity (same source as the small per-page footer). Empty fields hide. Layout is the same
  // for every company; only Massair CT gets its designed logo fallback and the units image.
  if (!profile || !(profile.legal_name || profile.trading_name)) return null;
  const id = profileIdentity(profile);
  const designed = /^massair ct\b/i.test(String(profile.legal_name || profile.trading_name));
  const legal = id.legalName || String(profile.trading_name || "").trim();
  const trading = String(profile.trading_name || "").replace(/\bt\/a\b.*$/i, "").trim();
  const co = {
    brand: trading && trading.toLowerCase() !== legal.toLowerCase() ? trading : (designed ? SIGNATURE_COMPANY.brand : legal),
    legalName: legal, tel: id.tel, whatsapp: id.whatsapp, email: id.email, web: id.web, vatNo: id.vatNo,
    address: id.addressLines.join(", "), logoUrl: (profile as { logo_url?: string | null }).logo_url || null,
  };
  const logo = co.logoUrl || (designed ? logoLight : null);
  const sep = <span className="mx-1.5 text-[#1AA7EC]">|</span>;
  const telCell = [co.tel && <span key="t">Tel: {co.tel}</span>, co.whatsapp && <span key="w">WhatsApp/Cell: {co.whatsapp}</span>].filter(Boolean);
  const webVat = [co.web && <span key="w">{co.web}</span>, co.vatNo && <span key="v">VAT No {co.vatNo}</span>].filter(Boolean);
  const join = (xs: unknown[]) => xs.flatMap((x, i) => (i ? [<span key={`s${i}`}>{sep}</span>, x] : [x])) as React.ReactNode[];
  return (
    <div data-pdf-bottom data-pdf-replaces-foot data-testid="invoice-signoff" className="pt-2 pb-4" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ height: 3, background: "linear-gradient(90deg,#1AA7EC 75%,#F7941D 75%)" }} />
      <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#1AA7EC]">Thank you for your business</p>
      <div className="mt-2 flex items-center">
        <div className="pr-5" style={{ borderRight: "3px solid #1AA7EC" }}>
          {logo ? <img src={logo} alt={co.brand} style={{ width: 150, height: "auto", display: "block" }} />
            : <div style={{ fontSize: 20, fontWeight: 800, color: "#0B4FA8", maxWidth: 150 }}>{co.brand}</div>}
        </div>
        <div className="pl-5" style={{ color: "#0B4FA8", fontSize: 11.5, lineHeight: 1.45 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{co.brand}</div>
          {co.legalName !== co.brand && <div style={{ fontWeight: 700 }}>{co.legalName}</div>}
          {telCell.length > 0 && <div>{join(telCell)}</div>}
          {co.email && <div>{co.email}</div>}
          {webVat.length > 0 && <div>{join(webVat)}</div>}
          {co.address && <div>{co.address}</div>}
        </div>
        {designed && <img src={units} alt="" className="ml-auto" style={{ width: 150, height: "auto" }} />}
      </div>
    </div>
  );
}
