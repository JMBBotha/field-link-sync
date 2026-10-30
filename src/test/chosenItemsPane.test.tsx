import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChosenItemsList from "@/components/quoting/ChosenItemsList";
import FloatingSelectedItems, { readFloatPref } from "@/components/catalog/quote-builder/FloatingSelectedItems";
import { matchChosenToLines, setChosenQty, removeChosen, chosenTotal } from "@/lib/chosenItems";
import type { PdfSelectedProduct } from "@/types/pdfSelection";

const basket: PdfSelectedProduct[] = [
  { code: "r1", description: "Sample 12k inverter", price: "14950", quantity: 1, unitType: "units", productId: "p1", productCode: "SAMPLE-12K" },
  { code: "r2", description: "Sample pipe kit", price: "1150", quantity: 2, unitType: "units", productCode: "SAMPLE-PK" },
];
const lines = [{ id: "L1", product_id: "p1", area_id: "a1", item_name: "Sample 12k inverter" }];
const areas = [{ id: "a1", name: "Sample room" }];

describe("Chosen items pane", () => {
  it("maps chosen items to quote rooms by product id, else marks not in quote", () => {
    const refs = matchChosenToLines(basket, lines, areas);
    expect(refs.r1).toEqual([{ lineId: "L1", areaName: "Sample room" }]);
    expect(refs.r2).toEqual([]);
  });
  it("basket-only qty/remove helpers", () => {
    expect(setChosenQty(basket, "r2", 0)[1].quantity).toBe(1);
    expect(removeChosen(basket, "r1").map((b) => b.code)).toEqual(["r2"]);
    expect(chosenTotal(basket)).toBe(17250);
  });
  it("renders list; qty and remove call onChange with basket only", () => {
    const onChange = vi.fn();
    render(<ChosenItemsList basket={basket} onChange={onChange} refs={matchChosenToLines(basket, lines, areas)} />);
    expect(screen.getAllByTestId("chosen-item")).toHaveLength(2);
    expect(screen.getByText("↳ Sample room")).toBeTruthy();
    expect(screen.getByTestId("chosen-not-in-quote")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("More")[0]);
    expect(onChange.mock.calls[0][0][0].quantity).toBe(2);
    fireEvent.click(screen.getAllByTestId("chosen-remove")[1]);
    expect(onChange.mock.calls[1][0]).toHaveLength(1);
  });
  it("floating card remembers minimised state", () => {
    localStorage.removeItem("t-pin");
    render(<FloatingSelectedItems persistKey="t-pin" title="Chosen items" onClose={() => {}}
      pdfSelection={{ selectedFromPdf: basket, setSelectedFromPdf: () => {}, handleSelectProduct: () => {}, updateSelectedItem: () => {} }}>
      <div>body</div>
    </FloatingSelectedItems>);
    fireEvent.click(screen.getByLabelText("Minimise"));
    expect(readFloatPref("t-pin")?.minimized).toBe(true);
  });
});
