import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useRole } from "@/hooks/useRole";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { useCompanyTerms, relocationTextOf } from "@/hooks/useCompanyTerms";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { groupTermsSections } from "@/components/quoting/QuoteTermsPage";
import { COMPANY } from "@/lib/companyIdentity";

/**
 * One company-wide Terms & Conditions (Johan 2026-10-28). Every quote, invoice and user gets the same set.
 * Only the main company's admin can change the "Existing / relocated units" wording here; everyone else sees it read-only.
 */
export default function CompanyTermsCard() {
  const { isAdmin } = useRole();
  const { isMain } = useIsMainCompany();
  const canEdit = isAdmin && isMain;
  const { data: row, refresh } = useCompanyTerms();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(relocationTextOf(row)); }, [row]);
  const sections = useMemo(() => groupTermsSections(buildTermsBlocks({ companyName: COMPANY.legalName })).slice(0, 11), []);

  const save = async () => {
    if (!row?.company_id) return;
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase.from("company_terms" as any) as any)
      .update({ relocation_clause: text.trim(), updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() })
      .eq("company_id", row.company_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Terms saved for every quote and invoice");
    refresh();
  };

  return (
    <Card data-testid="company-terms-card">
      <CardHeader>
        <CardTitle>Terms &amp; Conditions</CardTitle>
        <p className="text-sm text-muted-foreground">One set for the whole company. It prints on every quote and invoice, for every user. {canEdit ? "Only you (main admin) can change it." : "Managed by the main admin."}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Standard sections 1–11 (same on every document)</summary>
          <div className="mt-2 space-y-2">
            {sections.map((s, i) => (
              <div key={i}><p className="font-semibold">{String(i + 1).padStart(2, "0")} {s.heading}</p>
                {s.items.map((it, j) => <p key={j} className="text-xs text-muted-foreground">{it.text}</p>)}</div>
            ))}
          </div>
        </details>
        <div>
          <Label>Existing / relocated units (added automatically when a quote removes, relocates or reinstalls existing units)</Label>
          <Textarea data-testid="relocation-clause-text" readOnly={!canEdit} value={text} onChange={(e) => canEdit && setText(e.target.value)} className="mt-1 min-h-[140px]" />
        </div>
        {canEdit && (
          <div className="flex justify-end"><Button size="sm" onClick={save} disabled={saving || !text.trim()}>Save terms</Button></div>
        )}
      </CardContent>
    </Card>
  );
}
