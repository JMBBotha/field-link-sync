import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CashHealthView from "@/components/cashhealth/CashHealthView";
import { cashHealthFixture, cashHealthFixtureActions, FIXTURE_TODAY } from "@/lib/cashHealthFixture";

function row(ref: string) {
  const el = screen.getAllByTestId("cash-receipt-row").find((r) => r.textContent?.includes(ref));
  if (!el) throw new Error(`missing row ${ref}`);
  return el;
}

describe("expected money in house labels", () => {
  it("shows the linked house on deposit, final and full rows, and the client name when there is no house", () => {
    render(<CashHealthView data={cashHealthFixture} actions={cashHealthFixtureActions} tab="in" today={FIXTURE_TODAY} />);

    const deposit = row("FX-2001");
    expect(within(deposit).getByTestId("cash-receipt-house").textContent).toBe("House 12");
    expect(deposit.textContent).toContain("FX-2001");
    expect(deposit.textContent).toContain("Fixture Estate (Pty) Ltd");
    expect(deposit.textContent).toContain("Deposit");
    expect(deposit.textContent).toContain("Draft – not sent");
    expect(deposit.textContent).toContain("R 12 000");
    expect(within(deposit).getByLabelText("Expected date")).toHaveValue("2026-11-01");
    expect(within(deposit).getByLabelText("Leeway days")).toHaveValue(7);
    expect(within(deposit).getByLabelText("Confidence")).toHaveValue(60);
    expect(within(deposit).getByLabelText("Status")).toHaveValue("expected");

    const fin = row("FX-2002");
    expect(within(fin).getByTestId("cash-receipt-house").textContent).toBe("House 14");
    expect(fin.textContent).toContain("FX-2002");
    expect(fin.textContent).toContain("Final");
    expect(fin.textContent).not.toContain("Unscheduled");
    expect(within(fin).getByLabelText("Expected date")).toHaveValue("2026-12-01");
    expect(within(row("FX-2003")).getByLabelText("Expected date")).toHaveValue("2027-01-01");
    expect(within(row("FX-2004")).getByLabelText("Expected date")).toHaveValue("2027-03-01");
    const stillOpen = row("FX-2006");
    expect(within(stillOpen).getByTestId("cash-receipt-house").textContent).toBe("House 8");
    expect(stillOpen.textContent).toContain("Unscheduled – date not set");
    expect(within(stillOpen).getByLabelText("Expected date")).toHaveValue("");

    const full = row("FX-2005");
    expect(within(full).getByTestId("cash-receipt-house").textContent).toBe("House 3");
    expect(full.textContent).toContain("Full");
    expect(full.textContent).toContain("FX-2005");

    expect(within(row("FX-2003")).getByTestId("cash-receipt-house").textContent).toBe("House 27");
    expect(within(row("FX-2004")).getByTestId("cash-receipt-house").textContent).toBe("House 41");

    for (const [ref, name] of [["FX-310", "Rita Nkosi"], ["FX-311", "Sam Peters"]] as const) {
      const el = row(ref);
      expect(el.textContent).toContain(name);
      expect(el.textContent).toContain(ref);
      expect(within(el).queryByTestId("cash-receipt-house")).toBeNull();
      expect(el.textContent).not.toMatch(/House \d/);
    }
  });
});
