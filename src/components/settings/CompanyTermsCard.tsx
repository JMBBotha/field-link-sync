import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildTermsBlocks } from "@/lib/defaultTerms";
import { groupTermsSections } from "@/components/quoting/QuoteTermsPage";
import { COMPANY } from "@/lib/companyIdentity";

/**
 * One company-wide Terms & Conditions (Johan 2026-10-28). Every quote, invoice and user gets the same set.
 * The "Existing / relocated units" clause was removed (Johan 2 Nov 2026 15:30).
 */
export default function CompanyTermsCard() {
  const sections = useMemo(() => groupTermsSections(buildTermsBlocks({ companyName: COMPANY.legalName })).slice(0, 11), []);

  return (
    <Card data-testid="company-terms-card">
      <CardHeader>
        <CardTitle>Terms &amp; Conditions</CardTitle>
        <p className="text-sm text-muted-foreground">One set for the whole company. It prints on every quote and invoice, for every user.</p>
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
      </CardContent>
    </Card>
  );
}
