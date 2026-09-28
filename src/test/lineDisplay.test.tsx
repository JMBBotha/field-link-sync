import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { qtyLabel, shortInstallName, kitTitleFromMetadata } from "@/lib/lineDisplay";
import EstimateDocument, { groupEstimateInstallLines } from "@/components/quoting/EstimateDocument";
import { vi } from "vitest";
vi.mock("@/hooks/useCompanySettings", () => ({ useCompanySettings: () => ({ settings: { banking_details: {} } }) }));

const kit = {
  item_name: "12K INV 1/4&1/2 PIPING KIT COPPER LASSO ISO CABLE TIES ONLY", quantity: 1, unit_price: 1103.26,
  metadata: { install: { role: "piping_kit" }, kit: { unit_sell: 367.75, name: "12K INV 1/4&1/2 PIPING KIT", items: [
    { name: "Soft Drawn Copper - Soft Drawn Copper 1/4 Inch 15.24 mtr", quantity: 3 },
    { name: "Soft Drawn Copper - Soft Drawn Copper 1/2 Inch 15.24 mtr", quantity: 3 },
    { name: "Lasso Tape - Lasso Tape 48mm x 30mtr", quantity: 1 } ] } },
};
const inst = (role: string, item_name: string, quantity = 1, extra: any = {}) => ({ item_name, quantity, metadata: { install: { role }, ...extra } });

describe("qtyLabel", () => {
  it("units", () => {
    expect(qtyLabel(kit)).toBe("3 m");
    expect(qtyLabel({ item_name: "Labour", quantity: 3.5, metadata: { labour: true, hours: 3.5 } })).toBe("3.5 h");
    expect(qtyLabel(inst("trunking_main", "PVC Trunking 100 x 40 x 3mtr", 0.5, { qty_unit: "length", supplier_length_m: 3 }))).toBe("0.5 × 3 m length");
    expect(qtyLabel({ item_name: "Trunking", quantity: 3, metadata: { qty_unit: "metre" } })).toBe("3 m");
    expect(qtyLabel({ item_name: "Soft Drawn Copper 5/8 Inch 15.24 mtr", quantity: 1 })).toBe("1 × 15.24 m length");
    expect(qtyLabel({ item_name: "Samsung 24K INV MW", quantity: 1 })).toBe("1 each");
  });
});

describe("shortInstallName", () => {
  it("roles", () => {
    expect(shortInstallName(inst("bracket", "Galvanized Brackets - Galvanized Brackets 650mm (Per Set)"))).toBe("Wall bracket 650");
    expect(shortInstallName(inst("trunking_main", "PVC Trunking - PVC Trunking 100 x 40 x 3mtr", 0.5, { qty_unit: "length", supplier_length_m: 3 }))).toBe("Trunking 100×40 · 1.5 m");
    expect(shortInstallName(inst("trunking_small", "PVC Trunking 16 x 16 x 3mtr", 3, { qty_unit: "metre" }))).toBe("Trunking 16×16 · 3 m");
    expect(shortInstallName(inst("trunking_endcap", "PVC End Caps - PVC End Caps 100 x 40"))).toBe("End cap 100×40");
    expect(shortInstallName(inst("drain_pipe", "PVC Pipe - PVC Pipe 20mm x 4mtr", 1, { qty_unit: "length", supplier_length_m: 4 }))).toBe("Drain pipe 20 mm · 4 m");
    expect(shortInstallName(inst("drain_bend", "PVC Elbow - PVC Elbow 20mm", 3))).toBe("Drain elbow 20 mm");
    expect(shortInstallName({ item_name: "Labour", quantity: 3.5, metadata: { labour: true } })).toBe("Labour");
    expect(shortInstallName({ item_name: "Samsung", quantity: 1 })).toBeNull();
  });
});

describe("kitTitleFromMetadata", () => {
  it("sizes + metres", () => {
    expect(kitTitleFromMetadata(kit)).toBe("Piping kit 1/4 + 1/2 · 3 m");
    expect(kitTitleFromMetadata({ ...kit, metadata: { kit: { name: "9K 1/4&3/8 KIT", length_m: 5 } } })).toBe("Piping kit 1/4 + 3/8 · 5 m");
  });
});

describe("collapsed kit", () => {
  it("expanding doesn't change totals", () => {
    const line = { id: "k", name: kit.item_name, description: null, quantity: 1, unit_price: 1103.26, displayName: "Piping kit 1/4 + 1/2 · 3 m", unitText: "3 m",
      kitItems: [{ name: "Copper 1/4", qty: "3" }, { name: "Lasso", qty: "1" }] };
    const editing: any = { areas: [{ id: "a", name: "Bed", lines: [line] }], selectedLineId: null, onSelectLine() {}, onLineChange: vi.fn(), onDeleteLine() {}, onRenameArea() {}, onAddArea() {} };
    render(<EstimateDocument estimateNumber="Q" issueDate="2026-09-28" customerName="C" items={[]} subtotal={1103.26} taxRate={0.15} taxAmount={165.49} grandTotal={1268.75} editing={editing} />);
    const before = document.body.textContent!.match(/R\s?[\d\s ]+,\d{2}/g)!.join("|");
    expect(screen.queryByTestId("kit-contents")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show kit contents"));
    expect(screen.getByTestId("kit-contents").textContent).toContain("Copper 1/4");
    expect(document.body.textContent!.match(/R\s?[\d\s ]+,\d{2}/g)!.join("|")).toBe(before);
    expect(screen.getByTestId("qty-unit").textContent).toBe("3 m");
    expect(editing.onLineChange).not.toHaveBeenCalled();
  });
});

const editable = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, description: null, quantity: 1, unit_price: 10, ...extra,
});

describe("installation materials group", () => {
  const renderEstimate = (lines: any[]) => {
    const editing: any = { areas: [{ id: "a", name: "Bed", lines }], selectedLineId: null, onSelectLine() {}, onLineChange: vi.fn(), onDeleteLine() {}, onRenameArea() {}, onAddArea() {} };
    return render(<EstimateDocument estimateNumber="Q" issueDate="2026-09-28" customerName="C" items={[]} subtotal={70} taxRate={0.15} taxAmount={10.5} grandTotal={80.5} editing={editing} />);
  };

  it("groups six linked children and expands their unchanged editors", () => {
    const unit = editable("unit");
    const children = Array.from({ length: 6 }, (_, i) => editable(`install-${i + 1}`, { installRole: `role-${i}`, installUnitId: "unit" }));
    const grouped = groupEstimateInstallLines([unit, ...children]);
    expect(grouped.filter((row) => row.kind === "install-summary")).toHaveLength(1);
    const { container } = renderEstimate([unit, ...children]);
    expect(screen.getByText(/Installation materials/).textContent).toContain("6 items");
    expect(container.querySelector('[data-line-id="install-1"]')).toHaveClass("hidden");
    fireEvent.click(screen.getByLabelText("Show installation materials"));
    expect(container.querySelectorAll('[data-install-role^="role-"]:not(.hidden)')).toHaveLength(6);
    expect(screen.getAllByLabelText("Quantity")).toHaveLength(7);
  });

  it("renders no summary when a unit has no install children", () => {
    renderEstimate([editable("unit")]);
    expect(screen.queryByText(/Installation materials/)).toBeNull();
  });

  it("leaves an orphan install line visible as a normal editable row", () => {
    const { container } = renderEstimate([editable("orphan", { installRole: "bracket", installUnitId: "missing" })]);
    expect(screen.queryByText(/Installation materials/)).toBeNull();
    expect(container.querySelector('[data-line-id="orphan"]')).not.toHaveClass("hidden");
    expect(screen.getByLabelText("Quantity")).toBeInTheDocument();
  });
});
