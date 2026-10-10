import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import QtyStepper, { parseQty, stepQty } from "@/components/quoting/QtyStepper";

describe("QtyStepper (Johan 19:51)", () => {
  it("helpers: comma decimals, never below min", () => {
    expect(parseQty("4,5")).toBe(4.5);
    expect(Number.isNaN(parseQty(""))).toBe(true);
    expect(stepQty(4.5, 1, 0.1)).toBe(5.5);
    expect(stepQty(0.5, -1, 0.1)).toBe(0.1);
    expect(stepQty(0, -1, 0)).toBe(0);
  });
  it("right-aligned decimal input, select on focus, Enter commits, no -/+ buttons (Johan 21:15)", () => {
    const on = vi.fn();
    const { rerender } = render(<QtyStepper value={2} min={0} step={1} ariaLabel="Quantity" onCommit={on} />);
    const i = screen.getByLabelText("Quantity") as HTMLInputElement;
    expect(i.className).toMatch(/text-right/); expect(i.className).toMatch(/h-11/);
    expect(i.getAttribute("inputmode")).toBe("decimal");
    fireEvent.focus(i); expect(i.selectionStart).toBe(0); expect(i.selectionEnd).toBe(1);
    fireEvent.change(i, { target: { value: "7" } }); fireEvent.blur(i);
    expect(on).toHaveBeenLastCalledWith(7);
    expect(screen.queryByLabelText("Increase Quantity")).toBeNull(); expect(screen.queryByLabelText("Decrease Quantity")).toBeNull();
    rerender(<QtyStepper value={0.5} min={0.1} step={1} ariaLabel="Metres" onCommit={on} />);
    const m = screen.getByLabelText("Metres") as HTMLInputElement; on.mockClear();
    fireEvent.change(m, { target: { value: "0" } }); fireEvent.blur(m); expect(on).not.toHaveBeenCalled();
  });
  it("estimate lines use it; admin header has phone More menu + shrinking logo", () => {
    const e = readFileSync("src/components/quoting/EstimateDocument.tsx", "utf8");
    expect(e.match(/<QtyStepper /g)?.length).toBe(2);
    const a = readFileSync("src/components/admin/AdminLayout.tsx", "utf8");
    expect(a).toContain('data-testid="header-more"');
    expect(a).toMatch(/header-logo" className="hidden min-\[360px\]:block h-6/);
  });
});
