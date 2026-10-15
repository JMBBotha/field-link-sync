import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { eoeClause } from "@/lib/eoeClause";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { groupTermsSections, type TermsSection } from "@/components/quoting/QuoteTermsPage";
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
  const sections = groupTermsSections(blocks);
  const half = Math.ceil(sections.length / 2);
  const col = (list: TermsSection[], start: number) => (
    <div className="space-y-4">
      {list.map((s, i) => (
        <div key={i}>
          <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-[10px] font-bold text-white">
              {String(start + i + 1).padStart(2, "0")}
            </span>
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#1AA7EC]">{s.heading || "Terms"}</h4>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {s.items.map((it, j) => (
              <p key={j} className={`text-[12px] leading-relaxed text-slate-700 ${it.type === "banking" ? "font-semibold" : ""}`}>
                {it.type === "bullet" ? `• ${it.text}` : it.text}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <section data-testid="full-terms" className="mx-auto w-full rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm print:border-0 print:shadow-none">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-2 px-5 py-3 text-left text-base font-semibold text-[#1B3A5C] print:hidden">
        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        Full terms and conditions
      </button>
      <div className={`${open ? "block" : "hidden"} px-5 pb-5 print:block`}>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {col(sections.slice(0, half), 0)}
          {col(sections.slice(half), half)}
        </div>
        <p data-testid="full-terms-eoe" className="pt-3 text-[12px] text-slate-600">{eoeClause(profile?.legal_name || COMPANY.legalName, "quote")}</p>
      </div>
    </section>
  );
}
