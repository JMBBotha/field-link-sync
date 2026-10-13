import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { eoeClause } from "@/lib/eoeClause";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { COMPANY, cleanBanking } from "@/lib/companyIdentity";
import { profileBanking, type CompanyProfile } from "@/lib/companyProfiles";

/**
 * "Full terms and conditions" on the client quote/accept page (Johan 2026-10-12).
 * Same text as the T&C pages in every quote PDF (buildTermsBlocks), same company name + banking source.
 */
export default function FullTermsSection({ banking, profile }: { banking?: unknown; profile?: Partial<CompanyProfile> | null }) {
  const [open, setOpen] = useState(false);
  // Company record first (Johan 2026-10-12); settings banking / fixed name only as fallback.
  const s = cleanBanking(banking);
  const r = profileBanking(profile);
  const b = r ? { account_name: r.account_name || s.account_name, bank_name: r.bank_name || s.bank_name, account_number: r.account_number || s.account_number,
    branch_code: r.branch_code || s.branch_code, account_type: r.account_type || s.account_type } : s;
  const blocks = buildTermsBlocks({
    companyName: profile?.legal_name || COMPANY.legalName,
    bankName: b.bank_name || undefined, accountName: b.account_name,
    accountNumber: b.account_number || undefined, branchCode: b.branch_code || undefined, accountType: b.account_type || undefined,
  });
  return (
    <section data-testid="full-terms" className="mx-auto w-full rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm print:border-0 print:shadow-none">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-2 px-5 py-3 text-left text-base font-semibold text-[#1B3A5C] print:hidden">
        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        Full terms and conditions
      </button>
      <div className={`${open ? "block" : "hidden"} space-y-1.5 px-5 pb-5 text-[13px] leading-relaxed print:block`}>
        {blocks.map((bl, i) => {
          switch (bl.type) {
            case "title": return <h3 key={i} className="pt-2 text-center text-[15px] font-bold text-sky-700">{bl.text}</h3>;
            case "heading": return <h4 key={i} className="pt-3 font-bold text-sky-700">{bl.text}</h4>;
            case "bullet": return <p key={i} className="pl-4">• {bl.text}</p>;
            case "banking": return <p key={i} className="font-semibold">{bl.text}</p>;
            case "spacer": return <div key={i} className="h-1" />;
            default: return <p key={i}>{bl.text}</p>;
          }
        })}
        <p data-testid="full-terms-eoe" className="pt-3">{eoeClause(profile?.legal_name || COMPANY.legalName, "quote")}</p>
      </div>
    </section>
  );
}
