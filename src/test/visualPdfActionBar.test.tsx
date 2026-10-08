import { describe, it, expect } from "vitest";
import unifiedBuilderSource from "@/pages/admin/AdminQuoteBuilderPageUnified.tsx?raw";
import summarySource from "@/components/catalog/quote-builder/QuoteSummaryPanel.tsx?raw";

describe("Visual PDF uses the shared QuoteActionBar on phones", () => {
  it("shows QuoteActionBar for Build quote and for compact (phone/tablet) widths", () => {
    expect(unifiedBuilderSource).toContain('quoteId && (activeTab === "quote" || isCompact)');
    expect(unifiedBuilderSource).toContain("data-testid=\"quote-action-bar\"".replace("data-testid=\"quote-action-bar\"", "QuoteActionBar"));
    expect(unifiedBuilderSource).toContain("<QuoteActionBar");
  });

  it("no longer renders the old total + amber Send bottom bar", () => {
    expect(unifiedBuilderSource).not.toContain('isCompact && activeTab !== "quote"');
    expect(unifiedBuilderSource).not.toMatch(/bg-amber-500[\s\S]{0,120}Send/);
  });

  it("hides the summary-panel Send on phones so the shared bar is the only Send", () => {
    expect(unifiedBuilderSource).toContain("hideSend={isCompact}");
    expect(summarySource).toContain("hideSend");
    expect(summarySource).toContain("{!hideSend && (");
  });
});
