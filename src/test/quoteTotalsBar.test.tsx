import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QuoteTotalsBar, { depositLine } from "@/components/quoting/QuoteTotalsBar";
describe("R5 quote totals bar", () => {
  it("70% deposit for installs, full payment for units only", () => {
    expect(depositLine(10000, true).amount).toBe(7000);
    expect(depositLine(10000, false)).toEqual({ label: "Full payment (units only)", amount: 10000 });
  });
  it("renders total incl VAT and deposit", () => {
    render(<QuoteTotalsBar total={24850} hasInstall />);
    expect(screen.getByText("Total incl VAT")).toBeTruthy();
    expect(screen.getByText("70% deposit")).toBeTruthy();
  });
});
