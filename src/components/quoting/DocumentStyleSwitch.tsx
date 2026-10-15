import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDocumentCompanyProfile, clearDocumentCompanyProfileCache } from "@/hooks/useDocumentCompanyProfile";
import { documentStyleOf, type DocumentStyle } from "@/components/documents/BrandDocument";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";

/**
 * Johan 15 Oct: "give me a easy button option" — switch the company's quote look (Light / Bold)
 * straight from the quote screen instead of digging through Settings → Company → Invoice companies.
 *
 * Writes the same company_profiles.document_style column the settings dropdown writes, so both stay
 * in step. Admin only (the database only lets admins update that record). The change lands on new and
 * draft documents; anything already sent keeps the look it printed with.
 */
const OPTIONS: { key: DocumentStyle; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "bold", label: "Bold" },
];

export default function DocumentStyleSwitch({ companyId, onPicked }: { companyId?: string | null; onPicked?: (style: DocumentStyle) => void }) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const profile = useDocumentCompanyProfile(companyId ?? null, null, !!companyId);
  const [busy, setBusy] = useState(false);
  const current = documentStyleOf(profile);
  const id = (profile as any)?.id as string | undefined;

  if (!isAdmin || !profile || !id) return null;

  const pick = async (style: DocumentStyle) => {
    if (busy) return;
    const label = style === "bold" ? "Bold" : "Light";
    onPicked?.(style);
    if (style === current) {
      // Johan 15 Oct 18:01: "nothing happened from bold" — a tap on the look already in use used to
      // do absolutely nothing. It now says so and re-reads the record, so a tab left open on the
      // other look (or changed on another device) catches up instead of looking stuck.
      clearDocumentCompanyProfileCache();
      toast({ title: `${label} is already your quote look`, description: "This quote is already using it. If the page still shows the other look, tap it again — it has just been refreshed." });
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("company_profiles")
      .update({ document_style: style, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setBusy(false);
      toast({ title: "Couldn't change the quote look", description: error.message, variant: "destructive" });
      return;
    }
    // Documents already on screen re-read the record so the switch is visible straight away.
    clearDocumentCompanyProfileCache();
    setBusy(false);
    toast({
      title: `${style === "bold" ? "Bold" : "Light"} is now your quote look`,
      description: "New and draft quotes, invoices and purchase orders use it. Quotes already sent keep what they printed.",
    });
  };

  return (
    <div
      data-testid="document-style-switch"
      className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 pr-1 shadow-sm"
      role="group"
      aria-label="Quote look"
    >
      <span className="pl-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Look</span>
      {OPTIONS.map((o) => {
        const on = current === o.key;
        return (
          <button
            key={o.key}
            type="button"
            data-testid={`document-style-${o.key}`}
            aria-pressed={on}
            disabled={busy}
            onClick={() => void pick(o.key)}
            className={
              "h-7 rounded-full px-3 text-xs font-semibold transition " +
              (on
                ? "bg-primary text-primary-foreground"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
