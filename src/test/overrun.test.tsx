import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeOverrun } from "@/lib/overrun";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
import ActualOnSiteStep from "@/components/jobs/ActualOnSiteStep";

const base = { quotedHours: 4, job: { sell: 10000, gp: 3000 }, commissionPercent: 40 };

describe("computeOverrun", () => {
  it("adjusts GP and commission for labour + catalogue extras", () => {
    const r = computeOverrun({ ...base, actualHours: 6, labourCostPerHour: 300, extras: [{ name: "Bracket", product_id: "p", qty: 2, unitCost: 250 }, { name: "tape", qty: 1, unitCost: null }] });
    expect(r.extraHours).toBe(2);
    expect(r.labourCost).toBe(600);
    expect(r.extrasCost).toBe(500);
    expect(r.unknownExtras).toBe(1);
    expect(r.adjustedGp).toBe(1900);
    expect(r.adjustedGpPercent).toBe(19);
    expect(r.adjustedCommission).toBe(760);
  });
  it("clamps commission at 0 when adjusted GP is negative", () => {
    const r = computeOverrun({ ...base, actualHours: 20, labourCostPerHour: 500, extras: [] });
    expect(r.adjustedGp).toBe(-5000);
    expect(r.adjustedCommission).toBe(0);
  });
  it("missing labour rate: labour excluded and flagged", () => {
    const r = computeOverrun({ ...base, actualHours: 8, labourCostPerHour: null, extras: [] });
    expect(r.labourNotSet).toBe(true);
    expect(r.labourCost).toBeNull();
    expect(r.adjustedGp).toBe(3000);
    expect(r.adjustedCommission).toBe(1200);
  });
  it("actual under quoted never adds cost", () => {
    expect(computeOverrun({ ...base, actualHours: 2, labourCostPerHour: 300, extras: [] }).adjustedGp).toBe(3000);
  });
});

describe("tech completion never shows money", () => {
  it("Actual on site step renders no currency or cost fields", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ActualOnSiteStep value={{ actualHours: "5", extras: [{ product_id: "p", name: "Bracket", qty: 2 }], notes: "" }} onChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(container.textContent).not.toMatch(/R\s?\d|R |cost|price|GP|profit/i);
    const src = readFileSync("src/components/jobs/ActualOnSiteStep.tsx", "utf8");
    expect(src).not.toMatch(/cost_price|cost_excl|selling_price|unit_price|formatRand/);
    const sheet = readFileSync("src/components/jobs/JobCompletionSheet.tsx", "utf8");
    expect(sheet).not.toMatch(/currency\(|formatRand|line_total\)\)/);
  });
  it("client views never reference overrun data", () => {
    for (const f of ["src/components/client/ClientProposalView.tsx", "src/components/quoting/EstimateDocument.tsx", "src/components/quoting/SendQuoteDialog.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/job_overruns|lib\/overrun|computeOverrun|adjustedGp|Actual vs quoted/);
    }
  });
});
