import { profileBlockLines, profileContactLine, type CompanyProfile } from "@/lib/companyProfiles";
import { useDocumentCompanyProfile } from "@/hooks/useDocumentCompanyProfile";

/**
 * Right-aligned company block for quote/invoice documents.
 * Always from the company's own record (Johan 2026-10-12): `profile` if the caller has one
 * (invoice issuing company / public RPC), else the default company_profiles row for `companyId`
 * (or the signed-in user's company). Fixed block in companyIdentity.ts only if no record loads.
 */
export default function CompanyBlock({ className = "", profile, companyId, fetchProfile = true }: {
  className?: string;
  profile?: Partial<CompanyProfile> | null;
  companyId?: string | null;
  fetchProfile?: boolean;
}) {
  const p = useDocumentCompanyProfile(companyId, profile, fetchProfile);
  const [name, ...rest] = profileBlockLines(p);
  const contact = profileContactLine(p);
  return (
    <div data-testid="company-block" data-company-source={p?.legal_name ? "record" : "fallback"} className={`text-right text-xs leading-relaxed text-ink-secondary ${className}`}>
      <p className="text-base font-bold text-[#1B3A5C]">{name}</p>
      {rest.map((l) => <p key={l}>{l}</p>)}
      {contact && <p className="text-xs">{contact}</p>}
    </div>
  );
}
